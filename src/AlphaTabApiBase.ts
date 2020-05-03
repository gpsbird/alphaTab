import { AlphaSynthMidiFileHandler } from '@src/midi/AlphaSynthMidiFileHandler';
import { MidiFileGenerator } from '@src/midi/MidiFileGenerator';

import { MidiFile } from '@src/midi/MidiFile';
import { MidiTickLookup, MidiTickLookupFindBeatResult } from '@src/midi/MidiTickLookup';
import { IAlphaSynth } from '@src/synth/IAlphaSynth';
import { PlaybackRange } from '@src/synth/PlaybackRange';
import { PlayerState } from '@src/synth/PlayerState';
import { PlayerStateChangedEventArgs } from '@src/synth/PlayerStateChangedEventArgs';
import { PositionChangedEventArgs } from '@src/synth/PositionChangedEventArgs';
import { Environment } from '@src/Environment';
import { EventEmitter, IEventEmitter, IEventEmitterOfT, EventEmitterOfT } from '@src/EventEmitter';

import { AlphaTexImporter } from '@src/importer/AlphaTexImporter';

import { ByteBuffer } from '@src/io/ByteBuffer';
import { Beat } from '@src/model/Beat';
import { Score } from '@src/model/Score';
import { Track } from '@src/model/Track';

import { IContainer } from '@src/platform/IContainer';
import { IMouseEventArgs } from '@src/platform/IMouseEventArgs';
import { IUiFacade } from '@src/platform/IUiFacade';
import { Cursors } from '@src/platform/Cursors';
import { ScrollMode } from '@src/PlayerSettings';
import { BeatContainerGlyph } from '@src/rendering/glyphs/BeatContainerGlyph';

import { IScoreRenderer } from '@src/rendering/IScoreRenderer';

import { RenderFinishedEventArgs } from '@src/rendering/RenderFinishedEventArgs';
import { ScoreRenderer } from '@src/rendering/ScoreRenderer';
import { BeatBounds } from '@src/rendering/utils/BeatBounds';

import { Bounds } from '@src/rendering/utils/Bounds';
import { BoundsLookup } from '@src/rendering/utils/BoundsLookup';
import { MasterBarBounds } from '@src/rendering/utils/MasterBarBounds';
import { StaveGroupBounds } from '@src/rendering/utils/StaveGroupBounds';
import { ResizeEventArgs } from '@src/ResizeEventArgs';
import { Settings } from '@src/Settings';

import { Logger } from '@src/util/Logger';
import { ModelUtils } from '@src/model/ModelUtils';
import { AlphaTabError } from '@src/AlphaTabError';

class SelectionInfo {
    public beat: Beat;
    public bounds: BeatBounds | null = null;

    public constructor(beat: Beat) {
        this.beat = beat;
    }
}

/**
 * This class represents the public API of alphaTab and provides all logic to display
 * a music sheet in any UI using the given {@link IUiFacade}
 * @param <TSettings> The UI object holding the settings.
 */
export class AlphaTabApiBase<TSettings> {
    private _startTime: number = 0;
    private _trackIndexes: number[] | null = null;
    /**
     * Gets the UI facade to use for interacting with the user interface.
     */
    public readonly uiFacade: IUiFacade<TSettings>;

    /**
     * Gets the UI container that holds the whole alphaTab control.
     */
    public readonly container: IContainer;

    /**
     * Gets the score renderer used for rendering the music sheet. This is the low-level API responsible for the actual rendering chain.
     */
    public readonly renderer: IScoreRenderer;

    /**
     * Gets the score holding all information about the song being rendered.
     */
    public score: Score | null = null;

    /**
     * Gets the settings that are used for rendering the music notation.
     */
    public settings!: Settings;

    /**
     * Gets a list of the tracks that are currently rendered;
     */
    public tracks: Track[] = [];

    /**
     * Gets the UI container that will hold all rendered results.
     */
    public readonly canvasElement: IContainer;

    /**
     * Initializes a new instance of the {@link AlphaTabApiBase} class.
     * @param uiFacade The UI facade to use for interacting with the user interface.
     * @param settings The UI settings object to use for loading the settings.
     */
    public constructor(uiFacade: IUiFacade<TSettings>, settings: TSettings) {
        this.uiFacade = uiFacade;
        this.container = uiFacade.rootContainer;

        uiFacade.initialize(this, settings);
        Logger.logLevel = this.settings.core.logLevel;

        this.canvasElement = uiFacade.createCanvasElement();
        this.container.appendChild(this.canvasElement);
        this.container.resize.on(
            Environment.throttle(() => {
                if (this.container.width !== this.renderer.width) {
                    this.triggerResize();
                }
            }, uiFacade.resizeThrottle)
        );
        if (
            this.settings.core.useWorkers &&
            this.uiFacade.areWorkersSupported &&
            Environment.getRenderEngineFactory(this.settings).supportsWorkers
        ) {
            this.renderer = this.uiFacade.createWorkerRenderer();
        } else {
            this.renderer = new ScoreRenderer(this.settings);
        }
        let initialResizeEventInfo: ResizeEventArgs = new ResizeEventArgs();
        initialResizeEventInfo.oldWidth = this.renderer.width;
        initialResizeEventInfo.newWidth = this.container.width | 0;
        initialResizeEventInfo.settings = this.settings;
        this.onResize(initialResizeEventInfo);
        this.renderer.preRender.on(this.onRenderStarted.bind(this));
        this.renderer.renderFinished.on(_ => {
            this.onRenderFinished();
        });
        this.renderer.postRenderFinished.on(() => {
            let duration: number = Date.now() - this._startTime;
            Logger.info('rendering', 'Rendering completed in ' + duration + 'ms');
            this.onPostRenderFinished();
        });
        this.renderer.preRender.on(_ => {
            this._startTime = Date.now();
        });
        this.renderer.partialRenderFinished.on(this.appendRenderResult.bind(this));
        this.renderer.renderFinished.on(r => {
            this.appendRenderResult(r);
            this.appendRenderResult(null); // marks last element
        });
        this.renderer.error.on(this.onError.bind(this));
        if (this.settings.player.enablePlayer) {
            this.setupPlayer();
        }
        this.setupClickHandling();
        // delay rendering to allow ui to hook up with events first. 
        this.uiFacade.beginInvoke(()=> {
            this.uiFacade.initialRender();
        });
    }

    /**
     * Destroys the alphaTab control and restores the initial state of the UI.
     */
    public destroy(): void {
        if (this.player) {
            this.player.destroy();
        }
        this.uiFacade.destroy();
        this.renderer.destroy();
    }

    /**
     * Applies any changes that were done to the settings object and informs the {@link renderer} about any new values to consider.
     */
    public updateSettings(): void {
        this.renderer.updateSettings(this.settings);
        // enable/disable player if needed
        if (this.settings.player.enablePlayer) {
            this.setupPlayer();
        } else {
            this.destroyPlayer();
        }
    }

    /**
     * Attempts a load of the score represented by the given data object.
     * @param scoreData The data container supported by {@link IUiFacade}
     * @param trackIndexes The indexes of the tracks from the song that should be rendered. If not provided, the first track of the
     * song will be shown.
     * @returns true if the data object is supported and a load was initiated, otherwise false
     */
    public load(scoreData: unknown, trackIndexes?: number[]): boolean {
        try {
            return this.uiFacade.load(
                scoreData,
                score => {
                    this.renderScore(score, trackIndexes);
                },
                error => {
                    this.onError(error);
                }
            );
        } catch (e) {
            this.onError(e);
            return false;
        }
    }

    /**
     * Initiates a rendering of the given score.
     * @param score The score containing the tracks to be rendered.
     * @param trackIndexes The indexes of the tracks from the song that should be rendered. If not provided, the first track of the
     * song will be shown.
     */
    public renderScore(score: Score, trackIndexes?: number[]): void {
        let tracks: Track[] = [];
        if (!trackIndexes) {
            if (score.tracks.length > 0) {
                tracks.push(score.tracks[0]);
            }
        } else {
            if (trackIndexes.length === 0) {
                if (score.tracks.length > 0) {
                    tracks.push(score.tracks[0]);
                }
            } else if (trackIndexes.length === 1 && trackIndexes[0] === -1) {
                for (let track of score.tracks) {
                    tracks.push(track);
                }
            } else {
                for (let index of trackIndexes) {
                    if (index >= 0 && index <= score.tracks.length) {
                        tracks.push(score.tracks[index]);
                    }
                }
            }
        }
        this.internalRenderTracks(score, tracks);
    }

    /**
     * Renders the given list of tracks.
     * @param tracks The tracks to render. They must all belong to the same score.
     */
    public renderTracks(tracks: Track[]): void {
        if (tracks.length > 0) {
            let score: Score = tracks[0].score;
            for (let track of tracks) {
                if (track.score !== score) {
                    this.onError(new AlphaTabError('All rendered tracks must belong to the same score.'));
                    return;
                }
            }
            this.internalRenderTracks(score, tracks);
        }
    }

    private internalRenderTracks(score: Score, tracks: Track[]): void {
        if (score !== this.score) {
            ModelUtils.applyPitchOffsets(this.settings, score);
            this.score = score;
            this.tracks = tracks;
            this._trackIndexes = [];
            for (let track of tracks) {
                this._trackIndexes.push(track.index);
            }
            this.onScoreLoaded(score);
            this.loadMidiForScore();
            this.render();
        } else {
            this.tracks = tracks;
            this._trackIndexes = [];
            for (let track of tracks) {
                this._trackIndexes.push(track.index);
            }
            this.render();
        }
    }

    private triggerResize(): void {
        if (!this.container.isVisible) {
            Logger.warning(
                'Rendering',
                'AlphaTab container was invisible while autosizing, waiting for element to become visible',
                null
            );
            this.uiFacade.rootContainerBecameVisible.on(() => {
                Logger.info('Rendering', 'AlphaTab container became visible, doing autosizing', null);
                this.triggerResize();
            });
        } else {
            let resizeEventInfo: ResizeEventArgs = new ResizeEventArgs();
            resizeEventInfo.oldWidth = this.renderer.width;
            resizeEventInfo.newWidth = this.container.width;
            resizeEventInfo.settings = this.settings;
            this.onResize(resizeEventInfo);
            this.renderer.updateSettings(this.settings);
            this.renderer.width = this.container.width;
            this.renderer.resizeRender();
        }
    }

    private appendRenderResult(result: RenderFinishedEventArgs | null): void {
        if (result) {
            this.canvasElement.width = result.totalWidth;
            this.canvasElement.height = result.totalHeight;
            if (this._cursorWrapper) {
                this._cursorWrapper.width = result.totalWidth;
                this._cursorWrapper.height = result.totalHeight;
            }
        }
        if (!result || result.renderResult) {
            this.uiFacade.beginAppendRenderResults(result);
        }
    }

    /**
     * Tells alphaTab to render the given alphaTex.
     * @param tex The alphaTex code to render.
     * @param tracks If set, the given tracks will be rendered, otherwise the first track only will be rendered.
     */
    public tex(tex: string, tracks?: number[]): void {
        try {
            let parser: AlphaTexImporter = new AlphaTexImporter();
            let data: ByteBuffer = ByteBuffer.fromString(tex);
            parser.init(data, this.settings);
            let score: Score = parser.readScore();
            this.renderScore(score, tracks);
        } catch (e) {
            this.onError(e);
        }
    }

    /**
     * Attempts a load of the score represented by the given data object.
     * @param data The data object to decode
     * @returns true if the data object is supported and a load was initiated, otherwise false
     */
    public loadSoundFont(data: unknown): boolean {
        if (!this.player) {
            return false;
        }
        return this.uiFacade.loadSoundFont(data);
    }

    /**
     * Initiates a re-rendering of the current setup. If rendering is not yet possible, it will be deferred until the UI changes to be ready for rendering.
     */
    public render(): void {
        if (!this.renderer) {
            return;
        }
        if (this.uiFacade.canRender) {
            // when font is finally loaded, start rendering
            this.renderer.width = this.container.width;
            this.renderer.renderScore(this.score!, this._trackIndexes as any);
        } else {
            this.uiFacade.canRenderChanged.on(() => this.render());
        }
    }

    private _tickCache: MidiTickLookup | null = null;
    /**
     * Gets the alphaSynth player used for playback. This is the low-level API to the Midi synthesizer used for playback.
     */
    public player: IAlphaSynth | null = null;

    public get isReadyForPlayback(): boolean {
        if (!this.player) {
            return false;
        }
        return this.player.isReadyForPlayback;
    }

    public get playerState(): PlayerState {
        if (!this.player) {
            return PlayerState.Paused;
        }
        return this.player.state;
    }

    public get masterVolume(): number {
        if (!this.player) {
            return 0;
        }
        return this.player.masterVolume;
    }

    public set masterVolume(value: number) {
        if (this.player) {
            this.player.masterVolume = value;
        }
    }

    public get metronomeVolume(): number {
        if (!this.player) {
            return 0;
        }
        return this.player.metronomeVolume;
    }

    public set metronomeVolume(value: number) {
        if (this.player) {
            this.player.metronomeVolume = value;
        }
    }

    public get tickPosition(): number {
        if (!this.player) {
            return 0;
        }
        return this.player.tickPosition;
    }

    public set tickPosition(value: number) {
        if (this.player) {
            this.player.tickPosition = value;
        }
    }

    public get timePosition(): number {
        if (!this.player) {
            return 0;
        }
        return this.player.timePosition;
    }

    public set timePosition(value: number) {
        if (this.player) {
            this.player.timePosition = value;
        }
    }

    public get playbackRange(): PlaybackRange | null {
        if (!this.player) {
            return null;
        }
        return this.player.playbackRange;
    }

    public set playbackRange(value: PlaybackRange | null) {
        if (this.player) {
            this.player.playbackRange = value;
        }
    }

    public get playbackSpeed(): number {
        if (!this.player) {
            return 0;
        }
        return this.player.playbackSpeed;
    }

    public set playbackSpeed(value: number) {
        if (this.player) {
            this.player.playbackSpeed = value;
        }
    }

    public get isLooping(): boolean {
        if (!this.player) {
            return false;
        }
        return this.player.isLooping;
    }

    public set isLooping(value: boolean) {
        if (this.player) {
            this.player.isLooping = value;
        }
    }

    private destroyPlayer(): void {
        if (!this.player) {
            return;
        }
        this.player.destroy();
        this.player = null;
        this.destroyCursors();
    }

    private setupPlayer(): void {
        if (this.player) {
            return;
        }
        this.player = this.uiFacade.createWorkerPlayer();
        if (!this.player) {
            return;
        }
        this.player.ready.on(() => {
            this.loadMidiForScore();
        });
        this.player.readyForPlayback.on(() => {
            this.onPlayerReady();
            if (this.tracks) {
                for (let track of this.tracks) {
                    let volume: number = track.playbackInfo.volume / 16;
                    this.player!.setChannelVolume(track.playbackInfo.primaryChannel, volume);
                    this.player!.setChannelVolume(track.playbackInfo.secondaryChannel, volume);
                }
            }
        });
        this.player.soundFontLoaded.on(this.onSoundFontLoaded.bind(this));
        this.player.soundFontLoadFailed.on(e => {
            this.onError(e);
        });
        this.player.midiLoaded.on(this.onMidiLoaded.bind(this));
        this.player.midiLoadFailed.on(e => {
            this.onError(e);
        });
        this.player.stateChanged.on(this.onPlayerStateChanged.bind(this));
        this.player.positionChanged.on(this.onPlayerPositionChanged.bind(this));
        this.player.finished.on(this.onPlayerFinished.bind(this));
        if (this.settings.player.enableCursor) {
            this.setupCursors();
        } else {
            this.destroyCursors();
        }
    }

    private loadMidiForScore(): void {
        if (!this.player || !this.score || !this.player.isReady) {
            return;
        }
        Logger.info('AlphaTab', 'Generating Midi');
        let midiFile: MidiFile = new MidiFile();
        let handler: AlphaSynthMidiFileHandler = new AlphaSynthMidiFileHandler(midiFile);
        let generator: MidiFileGenerator = new MidiFileGenerator(this.score, this.settings, handler);
        generator.generate();
        this._tickCache = generator.tickLookup;
        this.player.loadMidiFile(midiFile);
    }

    /**
     * Changes the volume of the given tracks.
     * @param tracks The tracks for which the volume should be changed.
     * @param volume The volume to set for all tracks in percent (0-1)
     */
    public changeTrackVolume(tracks: Track[], volume: number): void {
        if (!this.player) {
            return;
        }
        for (let track of tracks) {
            this.player.setChannelVolume(track.playbackInfo.primaryChannel, volume);
            this.player.setChannelVolume(track.playbackInfo.secondaryChannel, volume);
        }
    }

    /**
     * Changes the given tracks to be played solo or not.
     * If one or more tracks are set to solo, only those tracks are hearable.
     * @param tracks The list of tracks to play solo or not.
     * @param solo If set to true, the tracks will be added to the solo list. If false, they are removed.
     */
    public changeTrackSolo(tracks: Track[], solo: boolean): void {
        if (!this.player) {
            return;
        }
        for (let track of tracks) {
            this.player.setChannelSolo(track.playbackInfo.primaryChannel, solo);
            this.player.setChannelSolo(track.playbackInfo.secondaryChannel, solo);
        }
    }

    /**
     * Changes the given tracks to be muted or not.
     * @param tracks The list of track to mute or unmute.
     * @param mute If set to true, the tracks will be muted. If false they are unmuted.
     */
    public changeTrackMute(tracks: Track[], mute: boolean): void {
        if (!this.player) {
            return;
        }
        for (let track of tracks) {
            this.player.setChannelMute(track.playbackInfo.primaryChannel, mute);
            this.player.setChannelMute(track.playbackInfo.secondaryChannel, mute);
        }
    }

    /**
     * Starts the playback of the current song.
     * @returns true if the playback was started, otherwise false. Reasons for not starting can be that the player is not ready or already playing.
     */
    public play(): boolean {
        if (!this.player) {
            return false;
        }
        return this.player.play();
    }

    /**
     * Pauses the playback of the current song.
     */
    public pause(): void {
        if (!this.player) {
            return;
        }
        this.player.pause();
    }

    /**
     * Toggles between play/pause depending on the current player state.
     */
    public playPause(): void {
        if (!this.player) {
            return;
        }
        this.player.playPause();
    }

    /**
     * Stops the playback of the current song, and moves the playback position back to the start.
     */
    public stop(): void {
        if (!this.player) {
            return;
        }
        this.player.stop();
    }

    private _cursorWrapper: IContainer | null = null;
    private _barCursor: IContainer | null = null;
    private _beatCursor: IContainer | null = null;
    private _selectionWrapper: IContainer | null = null;
    private _previousTick: number = 0;
    private _playerState: PlayerState = PlayerState.Paused;
    private _currentBeat: Beat | null = null;
    private _previousStateForCursor: PlayerState = PlayerState.Paused;
    private _previousCursorCache: BoundsLookup | null = null;
    private _lastScroll: number = 0;

    private destroyCursors(): void {
        if (!this._cursorWrapper) {
            return;
        }
        this.uiFacade.destroyCursors();
        this._cursorWrapper = null;
        this._barCursor = null;
        this._beatCursor = null;
        this._selectionWrapper = null;
        this._previousTick = 0;
        this._playerState = PlayerState.Paused;
    }

    private setupCursors(): void {
        //
        // Create cursors
        let cursors: Cursors = this.uiFacade.createCursors();
        if (!cursors) {
            return;
        }
        // store options and created elements for fast access
        this._cursorWrapper = cursors.cursorWrapper;
        this._barCursor = cursors.barCursor;
        this._beatCursor = cursors.beatCursor;
        this._selectionWrapper = cursors.selectionWrapper;
        //
        // Hook into events
        this._previousTick = 0;
        this._playerState = PlayerState.Paused;
        // we need to update our position caches if we render a tablature
        this.renderer.postRenderFinished.on(() => {
            this.cursorUpdateTick(this._previousTick, false);
        });
        if (this.player) {
            this.player.positionChanged.on(e => {
                this._previousTick = e.currentTick;
                this.uiFacade.beginInvoke(() => {
                    this.cursorUpdateTick(e.currentTick, false);
                });
            });
            this.player.stateChanged.on(e => {
                this._playerState = e.state;
                if (!e.stopped && e.state === PlayerState.Paused) {
                    let currentBeat: Beat | null = this._currentBeat;
                    let tickCache: MidiTickLookup | null = this._tickCache;
                    if (currentBeat && tickCache) {
                        this.player!.tickPosition =
                            tickCache.getMasterBarStart(currentBeat.voice.bar.masterBar) + currentBeat.playbackStart;
                    }
                }
            });
        }
    }

    /**
     * updates the cursors to highlight the beat at the specified tick position
     * @param tick
     * @param stop
     */
    private cursorUpdateTick(tick: number, stop: boolean = false): void {
        this.uiFacade.beginInvoke(() => {
            let cache: MidiTickLookup | null = this._tickCache;
            if (cache) {
                let tracks: Track[] = this.tracks;
                if (tracks.length > 0) {
                    let beat: MidiTickLookupFindBeatResult | null = cache.findBeat(tracks, tick);
                    if (beat) {
                        this.cursorUpdateBeat(
                            beat.currentBeat,
                            beat.nextBeat,
                            beat.duration,
                            stop,
                            beat.beatsToHighlight
                        );
                    }
                }
            }
        });
    }

    /**
     * updates the cursors to highlight the specified beat
     */
    private cursorUpdateBeat(
        beat: Beat,
        nextBeat: Beat | null,
        duration: number,
        stop: boolean,
        beatsToHighlight: Beat[] | null = null
    ): void {
        if (!beat) {
            return;
        }
        let cache: BoundsLookup | null = this.renderer.boundsLookup;
        if (!cache) {
            return;
        }
        let previousBeat: Beat | null = this._currentBeat;
        let previousCache: BoundsLookup | null = this._previousCursorCache;
        let previousState: PlayerState | null = this._previousStateForCursor;
        this._currentBeat = beat;
        this._previousCursorCache = cache;
        this._previousStateForCursor = this._playerState;
        if (beat === previousBeat && cache === previousCache && previousState === this._playerState) {
            return;
        }
        let barCursor: IContainer | null = this._barCursor;
        let beatCursor: IContainer | null = this._beatCursor;
        let beatBoundings: BeatBounds | null = cache.findBeat(beat);
        if (!beatBoundings) {
            return;
        }
        let barBoundings: MasterBarBounds = beatBoundings.barBounds.masterBarBounds;
        let barBounds: Bounds = barBoundings.visualBounds;
        if (barCursor) {
            barCursor.top = barBounds.y;
            barCursor.left = barBounds.x;
            barCursor.width = barBounds.w;
            barCursor.height = barBounds.h;
        }

        if (beatCursor) {
            // move beat to start position immediately
            beatCursor.stopAnimation();
            beatCursor.top = barBounds.y;
            beatCursor.left = beatBoundings.visualBounds.x;
            beatCursor.height = barBounds.h;
        }

        // if playing, animate the cursor to the next beat
        this.uiFacade.removeHighlights();
        if (this._playerState === PlayerState.Playing || stop) {
            duration /= this.playbackSpeed;
            if (!stop) {
                if (beatsToHighlight) {
                    for (let highlight of beatsToHighlight) {
                        let className: string = BeatContainerGlyph.getGroupId(highlight);
                        this.uiFacade.highlightElements(className);
                    }
                }
                let nextBeatX: number = barBoundings.visualBounds.x + barBoundings.visualBounds.w;
                // get position of next beat on same stavegroup
                if (nextBeat) {
                    // if we are moving within the same bar or to the next bar
                    // transition to the next beat, otherwise transition to the end of the bar.
                    if (
                        nextBeat.voice.bar.index === beat.voice.bar.index ||
                        nextBeat.voice.bar.index === beat.voice.bar.index + 1
                    ) {
                        let nextBeatBoundings: BeatBounds | null = cache.findBeat(nextBeat);
                        if (
                            nextBeatBoundings &&
                            nextBeatBoundings.barBounds.masterBarBounds.staveGroupBounds ===
                            barBoundings.staveGroupBounds
                        ) {
                            nextBeatX = nextBeatBoundings.visualBounds.x;
                        }
                    }
                }

                if (beatCursor) {
                    this.uiFacade.beginInvoke(() => {
                        // Logger.Info("Player",
                        //    "Transition from " + beatBoundings.VisualBounds.X + " to " + nextBeatX + " in " + duration +
                        //    "(" + Player.PlaybackRange + ")");
                        beatCursor!.transitionToX(duration, nextBeatX);
                    });
                }
            }
            if (!this._beatMouseDown && this.settings.player.scrollMode !== ScrollMode.Off) {
                let scrollElement: IContainer = this.uiFacade.getScrollContainer();
                let isVertical: boolean = Environment.getLayoutEngineFactory(this.settings).vertical;
                let mode: ScrollMode = this.settings.player.scrollMode;
                let elementOffset: Bounds = this.uiFacade.getOffset(scrollElement, this.container);
                if (isVertical) {
                    switch (mode) {
                        case ScrollMode.Continuous:
                            let y: number =
                                elementOffset.y + barBoundings.realBounds.y + this.settings.player.scrollOffsetY;
                            if (y !== this._lastScroll) {
                                this._lastScroll = y;
                                this.uiFacade.scrollToY(scrollElement, y, this.settings.player.scrollSpeed);
                            }
                            break;
                        case ScrollMode.OffScreen:
                            let elementBottom: number =
                                scrollElement.scrollTop + this.uiFacade.getOffset(null, scrollElement).h;
                            if (
                                barBoundings.visualBounds.y + barBoundings.visualBounds.h >= elementBottom ||
                                barBoundings.visualBounds.y < scrollElement.scrollTop
                            ) {
                                let scrollTop: number = barBoundings.realBounds.y + this.settings.player.scrollOffsetY;
                                this._lastScroll = barBoundings.visualBounds.x;
                                this.uiFacade.scrollToY(scrollElement, scrollTop, this.settings.player.scrollSpeed);
                            }
                            break;
                    }
                } else {
                    switch (mode) {
                        case ScrollMode.Continuous:
                            let x: number = barBoundings.visualBounds.x;
                            if (x !== this._lastScroll) {
                                let scrollLeft: number = barBoundings.realBounds.x + this.settings.player.scrollOffsetX;
                                this._lastScroll = barBoundings.visualBounds.x;
                                this.uiFacade.scrollToX(scrollElement, scrollLeft, this.settings.player.scrollSpeed);
                            }
                            break;
                        case ScrollMode.OffScreen:
                            let elementRight: number =
                                scrollElement.scrollLeft + this.uiFacade.getOffset(null, scrollElement).w;
                            if (
                                barBoundings.visualBounds.x + barBoundings.visualBounds.w >= elementRight ||
                                barBoundings.visualBounds.x < scrollElement.scrollLeft
                            ) {
                                let scrollLeft: number = barBoundings.realBounds.x + this.settings.player.scrollOffsetX;
                                this._lastScroll = barBoundings.visualBounds.x;
                                this.uiFacade.scrollToX(scrollElement, scrollLeft, this.settings.player.scrollSpeed);
                            }
                            break;
                    }
                }
            }
            // trigger an event for others to indicate which beat/bar is played
            this.onPlayedBeatChanged(beat);
        }
    }

    public playedBeatChanged: IEventEmitterOfT<Beat> = new EventEmitterOfT<Beat>();
    public addPlayedBeatChanged(value: (beat: Beat | null) => void) {
        Logger.warning('API', 'addPlayedBeatChanged is deprecated, use playedBeatChanged.on(..)');
        this.playedBeatChanged.on(value);
    }
    public removePlayedBeatChanged(value: (beat: Beat | null) => void) {
        Logger.warning('API', 'removePlayedBeatChanged is deprecated, use playedBeatChanged.off(..)');
        this.playedBeatChanged.off(value);
    }

    private onPlayedBeatChanged(beat: Beat): void {
        (this.playedBeatChanged as EventEmitterOfT<Beat>).trigger(beat);
        this.uiFacade.triggerEvent(this.container, 'playedBeatChanged', beat);
    }

    private _beatMouseDown: boolean = false;
    private _selectionStart: SelectionInfo | null = null;
    private _selectionEnd: SelectionInfo | null = null;

    public beatMouseDown: IEventEmitterOfT<Beat> = new EventEmitterOfT<Beat>();
    public addBeatMouseDown(value: (beat: Beat) => void) {
        Logger.warning('API', 'addBeatMouseDown is deprecated, use beatMouseDown.on(..)');
        this.beatMouseDown.on(value);
    }
    public removeBeatMouseDown(value: (beat: Beat) => void) {
        Logger.warning('API', 'removeBeatMouseDown is deprecated, use beatMouseDown.off(..)');
        this.beatMouseDown.off(value);
    }

    public beatMouseMove: IEventEmitterOfT<Beat> = new EventEmitterOfT<Beat>();
    public addBeatMouseMove(value: (beat: Beat) => void) {
        Logger.warning('API', 'addBeatMouseMove is deprecated, use beatMouseMove.on(..)');
        this.beatMouseMove.on(value);
    }
    public removeBeatMouseMove(value: (beat: Beat) => void) {
        Logger.warning('API', 'removeBeatMouseMove is deprecated, use beatMouseMove.off(..)');
        this.beatMouseMove.off(value);
    }

    public beatMouseUp: IEventEmitterOfT<Beat | null> = new EventEmitterOfT<Beat | null>();
    public addBeatMouseUp(value: (beat: Beat | null) => void) {
        Logger.warning('API', 'addBeatMouseUp is deprecated, use beatMouseUp.on(..)');
        this.beatMouseUp.on(value);
    }
    public removeBeatMouseUp(value: (beat: Beat | null) => void) {
        Logger.warning('API', 'removeBeatMouseUp is deprecated, use beatMouseUp.off(..)');
        this.beatMouseUp.off(value);
    }

    private onBeatMouseDown(originalEvent: IMouseEventArgs, beat: Beat): void {
        if (
            this.settings.player.enablePlayer &&
            this.settings.player.enableCursor &&
            this.settings.player.enableUserInteraction
        ) {
            this._selectionStart = new SelectionInfo(beat);
            this._selectionEnd = null;
        }
        this._beatMouseDown = true;
        (this.beatMouseDown as EventEmitterOfT<Beat>).trigger(beat);
        this.uiFacade.triggerEvent(this.container, 'beatMouseDown', beat, originalEvent);
    }

    private onBeatMouseMove(originalEvent: IMouseEventArgs, beat: Beat): void {
        if (this.settings.player.enableUserInteraction) {
            if (!this._selectionEnd || this._selectionEnd.beat !== beat) {
                this._selectionEnd = new SelectionInfo(beat);
                this.cursorSelectRange(this._selectionStart, this._selectionEnd);
            }
        }
        (this.beatMouseMove as EventEmitterOfT<Beat>).trigger(beat);
        this.uiFacade.triggerEvent(this.container, 'beatMouseMove', beat, originalEvent);
    }

    private onBeatMouseUp(originalEvent: IMouseEventArgs, beat: Beat | null): void {
        if (this.settings.player.enableUserInteraction) {
            // for the selection ensure start < end
            if (this._selectionEnd) {
                let startTick: number = this._selectionStart!.beat.absoluteDisplayStart;
                let endTick: number = this._selectionStart!.beat.absoluteDisplayStart;
                if (endTick < startTick) {
                    let t: SelectionInfo = this._selectionStart!;
                    this._selectionStart = this._selectionEnd;
                    this._selectionEnd = t;
                }
            }
            if (this._selectionStart && this._tickCache) {
                // get the start and stop ticks (which consider properly repeats)
                let tickCache: MidiTickLookup = this._tickCache;
                let realMasterBarStart: number = tickCache.getMasterBarStart(
                    this._selectionStart.beat.voice.bar.masterBar
                );
                // move to selection start
                this.cursorUpdateBeat(this._selectionStart.beat, null, 0, false, null);
                this.tickPosition = realMasterBarStart + this._selectionStart.beat.playbackStart;
                // set playback range
                if (this._selectionEnd && this._selectionStart.beat !== this._selectionEnd.beat) {
                    let realMasterBarEnd: number = tickCache.getMasterBarStart(
                        this._selectionEnd.beat.voice.bar.masterBar
                    );

                    let range = new PlaybackRange();
                    range.startTick = realMasterBarStart + this._selectionStart.beat.playbackStart;
                    range.endTick =
                        realMasterBarEnd +
                        this._selectionEnd.beat.playbackStart +
                        this._selectionEnd.beat.playbackDuration -
                        50;
                    this.playbackRange = range;
                } else {
                    this._selectionStart = null;
                    this.playbackRange = null;
                    this.cursorSelectRange(this._selectionStart, this._selectionEnd);
                }
            }
        }

        (this.beatMouseUp as EventEmitterOfT<Beat | null>).trigger(beat);
        this.uiFacade.triggerEvent(this.container, 'beatMouseUp', beat, originalEvent);
        this._beatMouseDown = false;
    }

    private setupClickHandling(): void {
        this.canvasElement.mouseDown.on(e => {
            if (!e.isLeftMouseButton) {
                return;
            }
            if (this.settings.player.enableUserInteraction) {
                e.preventDefault();
            }
            let relX: number = e.getX(this.canvasElement);
            let relY: number = e.getY(this.canvasElement);
            let beat: Beat | null = this.renderer.boundsLookup?.getBeatAtPos(relX, relY) ?? null;
            if (beat) {
                this.onBeatMouseDown(e, beat);
            }
        });
        this.canvasElement.mouseMove.on(e => {
            if (!this._beatMouseDown) {
                return;
            }
            let relX: number = e.getX(this.canvasElement);
            let relY: number = e.getY(this.canvasElement);
            let beat: Beat | null = this.renderer.boundsLookup?.getBeatAtPos(relX, relY) ?? null;
            if (beat) {
                this.onBeatMouseMove(e, beat);
            }
        });
        this.canvasElement.mouseUp.on(e => {
            if (!this._beatMouseDown) {
                return;
            }
            if (this.settings.player.enableUserInteraction) {
                e.preventDefault();
            }
            let relX: number = e.getX(this.canvasElement);
            let relY: number = e.getY(this.canvasElement);
            let beat: Beat | null = this.renderer.boundsLookup?.getBeatAtPos(relX, relY) ?? null;
            this.onBeatMouseUp(e, beat);
        });
        this.renderer.postRenderFinished.on(() => {
            if (
                !this._selectionStart ||
                !this.settings.player.enablePlayer ||
                !this.settings.player.enableCursor ||
                !this.settings.player.enableUserInteraction
            ) {
                return;
            }
            this.cursorSelectRange(this._selectionStart, this._selectionEnd);
        });
    }

    private cursorSelectRange(startBeat: SelectionInfo | null, endBeat: SelectionInfo | null): void {
        let cache: BoundsLookup | null = this.renderer.boundsLookup;
        if (!cache) {
            return;
        }
        let selectionWrapper: IContainer | null = this._selectionWrapper;
        if (!selectionWrapper) {
            return;
        }

        selectionWrapper.clear();
        if (!startBeat || !endBeat || startBeat.beat === endBeat.beat) {
            return;
        }

        if (!startBeat.bounds) {
            startBeat.bounds = cache.findBeat(startBeat.beat);
        }
        if (!endBeat.bounds) {
            endBeat.bounds = cache.findBeat(endBeat.beat);
        }
        let startTick: number = startBeat.beat.absolutePlaybackStart;
        let endTick: number = endBeat.beat.absolutePlaybackStart;
        if (endTick < startTick) {
            let t: SelectionInfo = startBeat;
            startBeat = endBeat;
            endBeat = t;
        }
        let startX: number = startBeat.bounds!.realBounds.x;
        let endX: number = endBeat.bounds!.realBounds.x + endBeat.bounds!.realBounds.w;
        if (endBeat.beat.index === endBeat.beat.voice.beats.length - 1) {
            endX =
                endBeat.bounds!.barBounds.masterBarBounds.realBounds.x +
                endBeat.bounds!.barBounds.masterBarBounds.realBounds.w;
        }
        // if the selection goes across multiple staves, we need a special selection highlighting
        if (
            startBeat.bounds!.barBounds.masterBarBounds.staveGroupBounds !==
            endBeat.bounds!.barBounds.masterBarBounds.staveGroupBounds
        ) {
            // from the startbeat to the end of the staff,
            // then fill all staffs until the end-beat staff
            // then from staff-start to the end beat (or to end of bar if it's the last beat)
            let staffStartX: number = startBeat.bounds!.barBounds.masterBarBounds.staveGroupBounds.visualBounds.x;
            let staffEndX: number =
                startBeat.bounds!.barBounds.masterBarBounds.staveGroupBounds.visualBounds.x +
                startBeat.bounds!.barBounds.masterBarBounds.staveGroupBounds.visualBounds.w;
            let startSelection: IContainer = this.uiFacade.createSelectionElement();
            startSelection.top = startBeat.bounds!.barBounds.masterBarBounds.visualBounds.y;
            startSelection.left = startX;
            startSelection.width = staffEndX - startX;
            startSelection.height = startBeat.bounds!.barBounds.masterBarBounds.visualBounds.h;
            selectionWrapper.appendChild(startSelection);
            let staffStartIndex: number = startBeat.bounds!.barBounds.masterBarBounds.staveGroupBounds.index + 1;
            let staffEndIndex: number = endBeat.bounds!.barBounds.masterBarBounds.staveGroupBounds.index;
            for (let staffIndex: number = staffStartIndex; staffIndex < staffEndIndex; staffIndex++) {
                let staffBounds: StaveGroupBounds = cache.staveGroups[staffIndex];
                let middleSelection: IContainer = this.uiFacade.createSelectionElement();
                middleSelection.top = staffBounds.visualBounds.y;
                middleSelection.left = staffStartX;
                middleSelection.width = staffEndX - staffStartX;
                middleSelection.height = staffBounds.visualBounds.h;
                selectionWrapper.appendChild(middleSelection);
            }
            let endSelection: IContainer = this.uiFacade.createSelectionElement();
            endSelection.top = endBeat.bounds!.barBounds.masterBarBounds.visualBounds.y;
            endSelection.left = staffStartX;
            endSelection.width = endX - staffStartX;
            endSelection.height = endBeat.bounds!.barBounds.masterBarBounds.visualBounds.h;
            selectionWrapper.appendChild(endSelection);
        } else {
            // if the beats are on the same staff, we simply highlight from the startbeat to endbeat
            let selection: IContainer = this.uiFacade.createSelectionElement();
            selection.top = startBeat.bounds!.barBounds.masterBarBounds.visualBounds.y;
            selection.left = startX;
            selection.width = endX - startX;
            selection.height = startBeat.bounds!.barBounds.masterBarBounds.visualBounds.h;
            selectionWrapper.appendChild(selection);
        }
    }

    public scoreLoaded: IEventEmitterOfT<Score> = new EventEmitterOfT<Score>();
    public addLoaded(value: (score: Score) => void) {
        Logger.warning('API', 'addLoaded is deprecated, use scoreLoaded.on(..)');
        this.scoreLoaded.on(value);
    }
    public removeLoaded(value: (score: Score) => void) {
        Logger.warning('API', 'removeLoaded is deprecated, use scoreLoaded.off(..)');
        this.scoreLoaded.off(value);
    }

    private onScoreLoaded(score: Score): void {
        (this.scoreLoaded as EventEmitterOfT<Score>).trigger(score);
        this.uiFacade.triggerEvent(this.container, 'scoreLoaded', score);

        // deprecated!
        this.uiFacade.triggerEvent(this.container, 'loaded', score);
    }

    public resize: IEventEmitterOfT<ResizeEventArgs> = new EventEmitterOfT<ResizeEventArgs>();
    public addResize(value: (args: ResizeEventArgs) => void) {
        Logger.warning('API', 'addResize is deprecated, use resize.on(..)');
        this.resize.on(value);
    }
    public removeResize(value: (args: ResizeEventArgs) => void) {
        Logger.warning('API', 'removeResize is deprecated, use resize.off(..)');
        this.resize.off(value);
    }

    private onResize(e: ResizeEventArgs): void {
        (this.resize as EventEmitterOfT<ResizeEventArgs>).trigger(e);
        this.uiFacade.triggerEvent(this.container, 'resize', e);
    }

    public renderStarted: IEventEmitterOfT<boolean> = new EventEmitterOfT<boolean>();
    public addRenderStarted(value: (isResize: boolean) => void) {
        Logger.warning('API', 'addRenderStarted is deprecated, use renderStarted.on(..)');
        this.renderStarted.on(value);
    }
    public removeRenderStarted(value: (isResize: boolean) => void) {
        Logger.warning('API', 'removeRenderStarted is deprecated, use renderStarted.off(..)');
        this.renderStarted.off(value);
    }

    private onRenderStarted(resize: boolean): void {
        (this.renderStarted as EventEmitterOfT<boolean>).trigger(resize);
        this.uiFacade.triggerEvent(this.container, 'renderStarted', resize);

        // deprecated
        this.uiFacade.triggerEvent(this.container, 'render', null);
    }

    public renderFinished: IEventEmitter = new EventEmitter();
    public addRenderFinished(value: () => void) {
        Logger.warning('API', 'addRenderFinished is deprecated, use renderFinished.on(..)');
        this.renderFinished.on(value);
    }
    public removeRenderFinished(value: () => void) {
        Logger.warning('API', 'removeRenderFinished is deprecated, use renderFinished.off(..)');
        this.renderFinished.off(value);
    }

    private onRenderFinished(): void {
        (this.renderFinished as EventEmitter).trigger();
        this.uiFacade.triggerEvent(this.container, 'renderFinished', null);

        // deprecated
        this.uiFacade.triggerEvent(this.container, 'rendered', null);
    }

    public postRenderFinished: IEventEmitter = new EventEmitter();
    public addPostRenderFinished(value: () => void) {
        Logger.warning('API', 'addPostRenderFinished is deprecated, use postRenderFinished.on(..)');
        this.postRenderFinished.on(value);
    }
    public removePostRenderFinished(value: () => void) {
        Logger.warning('API', 'removePostRenderFinished is deprecated, use postRenderFinished.off(..)');
        this.postRenderFinished.off(value);
    }

    private onPostRenderFinished(): void {
        (this.postRenderFinished as EventEmitter).trigger();
        this.uiFacade.triggerEvent(this.container, 'postRenderFinished', null);

        // deprecated
        this.uiFacade.triggerEvent(this.container, 'postRendered', null);
    }

    public error: IEventEmitterOfT<Error> = new EventEmitterOfT<Error>();
    public addError(value: (error: Error) => void) {
        Logger.warning('API', 'addError is deprecated, use error.on(..)');
        this.error.on(value);
    }
    public removeError(value: (error: Error) => void) {
        Logger.warning('API', 'removeError is deprecated, use error.off(..)');
        this.error.off(value);
    }

    public onError(error: Error): void {
        Logger.error('API', 'An unexpected error occurred', error);
        (this.error as EventEmitterOfT<Error>).trigger(error);
        this.uiFacade.triggerEvent(this.container, 'error', error);
    }

    public playerReady: IEventEmitter = new EventEmitter();
    public addReadyForPlayback(value: () => void) {
        Logger.warning('API', 'addReadyForPlayback is deprecated, use playerReady.on(..)');
        this.playerReady.on(value);
    }
    public removeReadyForPlayback(value: () => void) {
        Logger.warning('API', 'removeReadyForPlayback is deprecated, use playerReady.off(..)');
        this.playerReady.off(value);
    }

    private onPlayerReady(): void {
        (this.playerReady as EventEmitter).trigger();
        this.uiFacade.triggerEvent(this.container, 'playerReady', null);
    }

    public playerFinished: IEventEmitter = new EventEmitter();
    public addPlayerFinished(value: () => void) {
        Logger.warning('API', 'addPlayerFinished is deprecated, use playerFinished.on(..)');
        this.playerFinished.on(value);
    }
    public removePlayerFinished(value: () => void) {
        Logger.warning('API', 'removePlayerFinished is deprecated, use playerFinished.off(..)');
        this.playerFinished.off(value);
    }

    private onPlayerFinished(): void {
        (this.playerFinished as EventEmitter).trigger();
        this.uiFacade.triggerEvent(this.container, 'playerFinished', null);

        // deprecated
        this.uiFacade.triggerEvent(this.container, 'finished', null);
    }

    public soundFontLoaded: IEventEmitter = new EventEmitter();
    public addSoundFontLoaded(value: () => void) {
        Logger.warning('API', 'addSoundFontLoaded is deprecated, use soundFontLoaded.on(..)');
        this.soundFontLoaded.on(value);
    }
    public removeSoundFontLoaded(value: () => void) {
        Logger.warning('API', 'removeSoundFontLoaded is deprecated, use soundFontLoaded.off(..)');
        this.soundFontLoaded.off(value);
    }

    private onSoundFontLoaded(): void {
        (this.soundFontLoaded as EventEmitter).trigger();
        this.uiFacade.triggerEvent(this.container, 'soundFontLoaded', null);
    }

    public midiLoaded: IEventEmitter = new EventEmitter();
    public addMidiLoaded(value: () => void) {
        Logger.warning('API', 'addMidiLoaded is deprecated, use midiLoaded.on(..)');
        this.midiLoaded.on(value);
    }
    public removeMidiLoaded(value: () => void) {
        Logger.warning('API', 'removeMidiLoaded is deprecated, use midiLoaded.off(..)');
        this.midiLoaded.off(value);
    }

    private onMidiLoaded(): void {
        (this.midiLoaded as EventEmitter).trigger();
        this.uiFacade.triggerEvent(this.container, 'midiFileLoaded', null);
    }

    public playerStateChanged: IEventEmitterOfT<PlayerStateChangedEventArgs> = new EventEmitterOfT<
        PlayerStateChangedEventArgs
    >();
    public addPlayerStateChanged(value: (args: PlayerStateChangedEventArgs) => void) {
        Logger.warning('API', 'addPlayerStateChanged is deprecated, use playerStateChanged.on(..)');
        this.playerStateChanged.on(value);
    }
    public removePlayerStateChanged(value: (args: PlayerStateChangedEventArgs) => void) {
        Logger.warning('API', 'removePlayerStateChanged is deprecated, use playerStateChanged.off(..)');
        this.playerStateChanged.off(value);
    }

    private onPlayerStateChanged(e: PlayerStateChangedEventArgs): void {
        (this.playerStateChanged as EventEmitterOfT<PlayerStateChangedEventArgs>).trigger(e);
        this.uiFacade.triggerEvent(this.container, 'playerStateChanged', e);
    }

    public playerPositionChanged: IEventEmitterOfT<PositionChangedEventArgs> = new EventEmitterOfT<
        PositionChangedEventArgs
    >();
    public addPlayerPositionChanged(value: (args: PositionChangedEventArgs) => void) {
        Logger.warning('API', 'addPlayerPositionChanged is deprecated, use playerPositionChanged.on(..)');
        this.playerPositionChanged.on(value);
    }
    public removePlayerPositionChanged(value: (args: PositionChangedEventArgs) => void) {
        Logger.warning('API', 'removePlayerPositionChanged is deprecated, use playerPositionChanged.off(..)');
        this.playerPositionChanged.off(value);
    }

    private onPlayerPositionChanged(e: PositionChangedEventArgs): void {
        (this.playerPositionChanged as EventEmitterOfT<PositionChangedEventArgs>).trigger(e);
        this.uiFacade.triggerEvent(this.container, 'playerPositionChanged', e);

        // deprecated
        this.uiFacade.triggerEvent(this.container, 'positionChanged', e);
    }
}
