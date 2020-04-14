import { ControllerType } from '@src/audio/midi/event/ControllerType';
import { MidiEvent } from '@src/audio/midi/event/MidiEvent';
import { MidiFileGenerator } from '@src/audio/midi/generator/MidiFileGenerator';
import { MidiFile } from '@src/audio/midi/MidiFile';
import { MidiUtils } from '@src/audio/util/MidiUtils';
import { AlphaTexImporter } from '@src/importer/AlphaTexImporter';
import { Gp3To5Importer } from '@src/importer/Gp3To5Importer';
import { Gp7Importer } from '@src/importer/Gp7Importer';
import { ByteBuffer } from '@src/io/ByteBuffer';
import { Beat } from '@src/model/Beat';
import { DynamicValue } from '@src/model/DynamicValue';
import { GraceType } from '@src/model/GraceType';
import { Note } from '@src/model/Note';
import { PlaybackInformation } from '@src/model/PlaybackInformation';
import { Score } from '@src/model/Score';
import { Settings } from '@src/Settings';
import { Logger } from '@src/util/Logger';
import {
    BendEvent,
    ControlChangeEvent,
    FlatMidiEventGenerator,
    MidiEvent as FlatMidiEvent,
    NoteEvent,
    ProgramChangeEvent,
    TempoEvent,
    TimeSignatureEvent,
    TrackEndEvent
} from '@test/audio/FlatMidiEventGenerator';
import { TestPlatform } from '@test/TestPlatform';

describe('MidiFileGeneratorTest', () => {
    const parseTex = function (tex: string): Score {
        let importer: AlphaTexImporter = new AlphaTexImporter();
        importer.init(TestPlatform.createStringReader(tex), new Settings());
        return importer.readScore();
    };

    it('full-song', async () => {
        const buffer = await TestPlatform.loadFile('test-data/audio/full-song.gp5');
        let readerBase: Gp3To5Importer = new Gp3To5Importer();
        readerBase.init(ByteBuffer.fromBuffer(buffer), new Settings());
        let score: Score = readerBase.readScore();
        let generator: MidiFileGenerator = new MidiFileGenerator(score, null, new FlatMidiEventGenerator());
        generator.generate();
    });

    it('midi-order', () => {
        let midiFile: MidiFile = new MidiFile();
        midiFile.addEvent(new MidiEvent(0, 0, 0, 0));
        midiFile.addEvent(new MidiEvent(0, 0, 1, 0));
        midiFile.addEvent(new MidiEvent(100, 0, 2, 0));
        midiFile.addEvent(new MidiEvent(50, 0, 3, 0));
        midiFile.addEvent(new MidiEvent(50, 0, 4, 0));
        expect(midiFile.events[0].data1).toEqual(0);
        expect(midiFile.events[1].data1).toEqual(1);
        expect(midiFile.events[2].data1).toEqual(3);
        expect(midiFile.events[3].data1).toEqual(4);
        expect(midiFile.events[4].data1).toEqual(2);
    });

    it('bend', () => {
        let tex: string = ':4 15.6{b(0 4)} 15.6';
        let score: Score = parseTex(tex);
        expect(score.tracks.length).toEqual(1);
        expect(score.tracks[0].staves[0].bars.length).toEqual(1);
        expect(score.tracks[0].staves[0].bars[0].voices.length).toEqual(1);
        expect(score.tracks[0].staves[0].bars[0].voices[0].beats.length).toEqual(2);
        expect(score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.length).toEqual(1);
        expect(score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes.length).toEqual(1);
        let handler: FlatMidiEventGenerator = new FlatMidiEventGenerator();
        let generator: MidiFileGenerator = new MidiFileGenerator(score, null, handler);
        generator.generate();
        let info: PlaybackInformation = score.tracks[0].playbackInfo;
        let note: Note = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        let expectedEvents: FlatMidiEvent[] = [
            // channel init
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.VolumeCoarse, 120),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.PanCoarse, 64),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.ExpressionControllerCoarse, 127),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.RegisteredParameterFine, 0),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.RegisteredParameterCourse, 0),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.DataEntryFine, 0),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.DataEntryCoarse, 12),
            new ProgramChangeEvent(0, 0, info.primaryChannel, info.program),

            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.VolumeCoarse, 120),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.PanCoarse, 64),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.ExpressionControllerCoarse, 127),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.RegisteredParameterFine, 0),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.RegisteredParameterCourse, 0),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.DataEntryFine, 0),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.DataEntryCoarse, 12),
            new ProgramChangeEvent(0, 0, info.secondaryChannel, info.program),

            new TimeSignatureEvent(0, 4, 4),
            new TempoEvent(0, 120),

            // bend effect
            new BendEvent(0, 0, info.secondaryChannel, 32), // no bend
            new BendEvent(0, 0, info.secondaryChannel, 32),
            new BendEvent(87, 0, info.secondaryChannel, 33),
            new BendEvent(174, 0, info.secondaryChannel, 34),
            new BendEvent(261, 0, info.secondaryChannel, 35),
            new BendEvent(349, 0, info.secondaryChannel, 36),
            new BendEvent(436, 0, info.secondaryChannel, 37),
            new BendEvent(523, 0, info.secondaryChannel, 38),
            new BendEvent(610, 0, info.secondaryChannel, 39),
            new BendEvent(698, 0, info.secondaryChannel, 40),
            new BendEvent(785, 0, info.secondaryChannel, 41),
            new BendEvent(872, 0, info.secondaryChannel, 42),
            new BendEvent(959, 0, info.secondaryChannel, 43),

            // note itself
            new NoteEvent(
                0,
                0,
                info.secondaryChannel,
                MidiUtils.toTicks(note.beat.duration),
                note.realValue,
                note.dynamics
            ),

            // reset bend
            new BendEvent(960, 0, info.primaryChannel, 32),
            new NoteEvent(
                960,
                0,
                info.primaryChannel,
                MidiUtils.toTicks(note.beat.duration),
                note.realValue,
                note.dynamics
            ),

            // end of track
            new TrackEndEvent(3840, 0) // 3840 = end of bar
        ];
        for (let i: number = 0; i < handler.midiEvents.length; i++) {
            Logger.info('Test', `i[${i}] ${handler.midiEvents[i]}`);
            if (i < expectedEvents.length) {
                expect(expectedEvents[i].equals(handler.midiEvents[i])).toEqual(
                    true,
                    `${expectedEvents[i]} !== ${handler.midiEvents[i]}`
                );
            }
        }
        expect(handler.midiEvents.length).toEqual(expectedEvents.length);
    });

    it('grace-beats', async () => {
        let reader: Gp7Importer = new Gp7Importer();
        const buffer = await TestPlatform.loadFile('test-data/audio/grace-beats.gp');
        let settings: Settings = Settings.songBook;
        reader.init(ByteBuffer.fromBuffer(buffer), settings);
        let score: Score = reader.readScore();
        let handler: FlatMidiEventGenerator = new FlatMidiEventGenerator();
        let generator: MidiFileGenerator = new MidiFileGenerator(score, settings, handler);
        generator.generate();
        // on beat
        let tick: number = 0;
        let ticks: number[] = [];
        expect(score.tracks[0].staves[0].bars[0].voices[0].beats[0].absolutePlaybackStart).toEqual(tick);
        expect(score.tracks[0].staves[0].bars[0].voices[0].beats[0].playbackDuration).toEqual(3840);
        ticks.push(tick);
        tick += score.tracks[0].staves[0].bars[0].voices[0].beats[0].playbackDuration;
        expect(score.tracks[0].staves[0].bars[1].voices[0].beats[0].absolutePlaybackStart).toEqual(tick);
        expect(score.tracks[0].staves[0].bars[1].voices[0].beats[0].playbackDuration).toEqual(120);
        ticks.push(tick);
        tick += score.tracks[0].staves[0].bars[1].voices[0].beats[0].playbackDuration;
        expect(score.tracks[0].staves[0].bars[1].voices[0].beats[1].absolutePlaybackStart).toEqual(tick);
        expect(score.tracks[0].staves[0].bars[1].voices[0].beats[1].playbackDuration).toEqual(3720);
        ticks.push(tick);
        tick += score.tracks[0].staves[0].bars[1].voices[0].beats[1].playbackDuration;
        // before beat
        expect(score.tracks[0].staves[0].bars[2].voices[0].beats[0].absolutePlaybackStart).toEqual(tick);
        expect(score.tracks[0].staves[0].bars[2].voices[0].beats[0].playbackDuration).toEqual(3720);
        ticks.push(tick);
        tick += score.tracks[0].staves[0].bars[2].voices[0].beats[0].playbackDuration;
        expect(score.tracks[0].staves[0].bars[3].voices[0].beats[0].absolutePlaybackStart).toEqual(tick);
        expect(score.tracks[0].staves[0].bars[3].voices[0].beats[0].playbackDuration).toEqual(120);
        ticks.push(tick);
        tick += score.tracks[0].staves[0].bars[3].voices[0].beats[0].playbackDuration;
        expect(score.tracks[0].staves[0].bars[3].voices[0].beats[1].absolutePlaybackStart).toEqual(tick);
        expect(score.tracks[0].staves[0].bars[3].voices[0].beats[1].playbackDuration).toEqual(3840);
        ticks.push(tick);
        tick += score.tracks[0].staves[0].bars[3].voices[0].beats[1].playbackDuration;
        // bend
        expect(score.tracks[0].staves[0].bars[4].voices[0].beats[0].graceType).toEqual(GraceType.BendGrace);
        expect(score.tracks[0].staves[0].bars[4].voices[0].beats[0].absolutePlaybackStart).toEqual(tick);
        expect(score.tracks[0].staves[0].bars[4].voices[0].beats[0].playbackDuration).toEqual(1920);
        ticks.push(tick);
        tick += score.tracks[0].staves[0].bars[4].voices[0].beats[0].playbackDuration;
        expect(score.tracks[0].staves[0].bars[4].voices[0].beats[1].absolutePlaybackStart).toEqual(tick);
        expect(score.tracks[0].staves[0].bars[4].voices[0].beats[1].playbackDuration).toEqual(1920);
        ticks.push(tick);
        tick += score.tracks[0].staves[0].bars[4].voices[0].beats[1].playbackDuration;
        let info: PlaybackInformation = score.tracks[0].playbackInfo;
        let expectedEvents: FlatMidiEvent[] = [
            // channel init
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.VolumeCoarse, 120),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.PanCoarse, 64),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.ExpressionControllerCoarse, 127),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.RegisteredParameterFine, 0),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.RegisteredParameterCourse, 0),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.DataEntryFine, 0),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.DataEntryCoarse, 12),
            new ProgramChangeEvent(0, 0, info.primaryChannel, info.program),

            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.VolumeCoarse, 120),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.PanCoarse, 64),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.ExpressionControllerCoarse, 127),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.RegisteredParameterFine, 0),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.RegisteredParameterCourse, 0),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.DataEntryFine, 0),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.DataEntryCoarse, 12),
            new ProgramChangeEvent(0, 0, info.secondaryChannel, info.program),

            new TimeSignatureEvent(0, 4, 4),
            new TempoEvent(0, 120),

            // on beat
            new BendEvent(ticks[0], 0, info.primaryChannel, 32),
            new NoteEvent(ticks[0], 0, info.primaryChannel, 3840, 67, DynamicValue.F),

            new BendEvent(ticks[1], 0, info.primaryChannel, 32),
            new NoteEvent(ticks[1], 0, info.primaryChannel, 120, 67, DynamicValue.F),

            new BendEvent(ticks[2], 0, info.primaryChannel, 32),
            new NoteEvent(ticks[2], 0, info.primaryChannel, 3720, 67, DynamicValue.F),

            // before beat
            new BendEvent(ticks[3], 0, info.primaryChannel, 32),
            new NoteEvent(ticks[3], 0, info.primaryChannel, 3720, 67, DynamicValue.F),

            new BendEvent(ticks[4], 0, info.primaryChannel, 32),
            new NoteEvent(ticks[4], 0, info.primaryChannel, 120, 67, DynamicValue.F),

            new BendEvent(ticks[5], 0, info.primaryChannel, 32),
            new NoteEvent(ticks[5], 0, info.primaryChannel, 3840, 67, DynamicValue.F),

            // bend beat
            new BendEvent(ticks[6], 0, info.secondaryChannel, 32),
            new BendEvent(ticks[6] + 13 * 0, 0, info.secondaryChannel, 32),
            new BendEvent(ticks[6] + 13 * 1, 0, info.secondaryChannel, 33),
            new BendEvent(ticks[6] + 13 * 2, 0, info.secondaryChannel, 34),
            new BendEvent(ticks[6] + 13 * 3, 0, info.secondaryChannel, 35),
            new BendEvent(ticks[6] + 13 * 4, 0, info.secondaryChannel, 36),
            new BendEvent(ticks[6] + 13 * 5, 0, info.secondaryChannel, 37),
            new BendEvent(ticks[6] + 13 * 6, 0, info.secondaryChannel, 38),
            new BendEvent(ticks[6] + 13 * 7, 0, info.secondaryChannel, 39),
            new BendEvent(ticks[6] + 13 * 8, 0, info.secondaryChannel, 40),
            new BendEvent(ticks[6] + 13 * 9, 0, info.secondaryChannel, 41),
            new BendEvent(ticks[6] + 13 * 10, 0, info.secondaryChannel, 42),
            new BendEvent(ticks[6] + 13 * 11 + 1, 0, info.secondaryChannel, 43),
            new NoteEvent(ticks[6], 0, info.secondaryChannel, 3840, 67, DynamicValue.F),

            // end of track
            new TrackEndEvent(19200, 0) // 3840 = end of bar
        ];

        for (let i: number = 0; i < handler.midiEvents.length; i++) {
            Logger.info('Test', `i[${i}] ${handler.midiEvents[i]}`);
            if (i < expectedEvents.length) {
                expect(handler.midiEvents[i].equals(expectedEvents[i])).toEqual(
                    true,
                    `${expectedEvents[i]} !== ${handler.midiEvents[i]}`
                );
            }
        }
        expect(handler.midiEvents.length).toEqual(expectedEvents.length);
    });

    it('bend-multi-point', () => {
        let tex: string = ':4 15.6{b(0 4 0)} 15.6';
        let score: Score = parseTex(tex);
        expect(score.tracks.length).toEqual(1);
        expect(score.tracks[0].staves[0].bars.length).toEqual(1);
        expect(score.tracks[0].staves[0].bars[0].voices.length).toEqual(1);
        expect(score.tracks[0].staves[0].bars[0].voices[0].beats.length).toEqual(2);
        expect(score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.length).toEqual(1);
        expect(score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes.length).toEqual(1);
        let handler: FlatMidiEventGenerator = new FlatMidiEventGenerator();
        let generator: MidiFileGenerator = new MidiFileGenerator(score, null, handler);
        generator.generate();
        let info: PlaybackInformation = score.tracks[0].playbackInfo;
        let note: Note = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        let expectedEvents: FlatMidiEvent[] = [
            // channel init
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.VolumeCoarse, 120),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.PanCoarse, 64),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.ExpressionControllerCoarse, 127),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.RegisteredParameterFine, 0),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.RegisteredParameterCourse, 0),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.DataEntryFine, 0),
            new ControlChangeEvent(0, 0, info.primaryChannel, ControllerType.DataEntryCoarse, 12),
            new ProgramChangeEvent(0, 0, info.primaryChannel, info.program),

            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.VolumeCoarse, 120),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.PanCoarse, 64),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.ExpressionControllerCoarse, 127),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.RegisteredParameterFine, 0),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.RegisteredParameterCourse, 0),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.DataEntryFine, 0),
            new ControlChangeEvent(0, 0, info.secondaryChannel, ControllerType.DataEntryCoarse, 12),
            new ProgramChangeEvent(0, 0, info.secondaryChannel, info.program),

            new TimeSignatureEvent(0, 4, 4),
            new TempoEvent(0, 120),

            // bend effect
            new BendEvent(0, 0, info.secondaryChannel, 32), // no bend
            new BendEvent(0, 0, info.secondaryChannel, 32),
            new BendEvent(43, 0, info.secondaryChannel, 33),
            new BendEvent(87, 0, info.secondaryChannel, 34),
            new BendEvent(130, 0, info.secondaryChannel, 35),
            new BendEvent(174, 0, info.secondaryChannel, 36),
            new BendEvent(218, 0, info.secondaryChannel, 37),
            new BendEvent(261, 0, info.secondaryChannel, 38),
            new BendEvent(305, 0, info.secondaryChannel, 39),
            new BendEvent(349, 0, info.secondaryChannel, 40),
            new BendEvent(392, 0, info.secondaryChannel, 41),
            new BendEvent(436, 0, info.secondaryChannel, 42),
            new BendEvent(479, 0, info.secondaryChannel, 43), // full bend

            new BendEvent(480, 0, info.secondaryChannel, 43), // full bend
            new BendEvent(523, 0, info.secondaryChannel, 42),
            new BendEvent(567, 0, info.secondaryChannel, 41),
            new BendEvent(610, 0, info.secondaryChannel, 40),
            new BendEvent(654, 0, info.secondaryChannel, 39),
            new BendEvent(698, 0, info.secondaryChannel, 38),
            new BendEvent(741, 0, info.secondaryChannel, 37),
            new BendEvent(785, 0, info.secondaryChannel, 36),
            new BendEvent(829, 0, info.secondaryChannel, 35),
            new BendEvent(872, 0, info.secondaryChannel, 34),
            new BendEvent(916, 0, info.secondaryChannel, 33),
            new BendEvent(959, 0, info.secondaryChannel, 32), // no bend

            // note itself
            new NoteEvent(
                0,
                0,
                info.secondaryChannel,
                MidiUtils.toTicks(note.beat.duration),
                note.realValue,
                note.dynamics
            ),

            // reset bend
            new BendEvent(960, 0, info.primaryChannel, 32), // finish
            new NoteEvent(
                960,
                0,
                info.primaryChannel,
                MidiUtils.toTicks(note.beat.duration),
                note.realValue,
                note.dynamics
            ), // end of track
            new TrackEndEvent(3840, 0) // 3840 = end of bar
        ];
        for (let i: number = 0; i < handler.midiEvents.length; i++) {
            Logger.info('Test', `i[${i}] ${handler.midiEvents[i]}`);
            if (i < expectedEvents.length) {
                expect(expectedEvents[i].equals(handler.midiEvents[i])).toEqual(
                    true,
                    `${expectedEvents[i]} !== ${handler.midiEvents[i]}`
                );
            }
        }
        expect(handler.midiEvents.length).toEqual(expectedEvents.length);
    });

    it('triplet-feel', () => {
        let tex: string =
            '\\ts 2 4 \\tf t8 3.2.8*4 | \\tf t16 3.2.16*8 | \\tf d8 3.2.8*4 | \\tf d16 3.2.16*8 | \\tf s8 3.2.8*4 | \\tf s16 3.2.16*8';
        let score: Score = parseTex(tex);
        // prettier-ignore
        let expectedPlaybackStartTimes: number[] = [
            0, 480, 960, 1440,
            0, 240, 480, 720, 960, 1200, 1440, 1680,
            0, 480, 960, 1440,
            0, 240, 480, 720, 960, 1200, 1440, 1680,
            0, 480, 960, 1440,
            0, 240, 480, 720, 960, 1200, 1440, 1680
        ];
        // prettier-ignore
        let expectedPlaybackDurations: number[] = [
            480, 480, 480, 480,
            240, 240, 240, 240, 240, 240, 240, 240,
            480, 480, 480, 480,
            240, 240, 240, 240, 240, 240, 240, 240,
            480, 480, 480, 480,
            240, 240, 240, 240, 240, 240, 240, 240
        ];
        let actualPlaybackStartTimes: number[] = [];
        let actualPlaybackDurations: number[] = [];
        let beat: Beat | null = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
        while (beat) {
            actualPlaybackStartTimes.push(beat.playbackStart);
            actualPlaybackDurations.push(beat.playbackDuration);
            beat = beat.nextBeat;
        }
        expect(actualPlaybackStartTimes.join(',')).toEqual(expectedPlaybackStartTimes.join(','));
        expect(actualPlaybackDurations.join(',')).toEqual(expectedPlaybackDurations.join(','));
        // prettier-ignore
        let expectedMidiStartTimes: number[] = [
            0, 640, 960, 1600,
            1920, 2240, 2400, 2720, 2880, 3200, 3360, 3680,
            3840, 4560, 4800, 5520,
            5760, 6120, 6240, 6600, 6720, 7080, 7200, 7560,
            7680, 7920, 8640, 8880,
            9600, 9720, 10080, 10200, 10560, 10680, 11040, 11160
        ];
        // prettier-ignore
        let expectedMidiDurations: number[] = [
            640, 320, 640, 320,
            320, 160, 320, 160, 320, 160, 320 ,160,
            720, 240, 720, 240,
            360, 120, 360, 120, 360, 120, 360, 120,
            240, 720, 240, 720,
            120, 360, 120, 360, 120, 360, 120, 360
        ];

        let actualMidiStartTimes: number[] = [];
        let actualMidiDurations: number[] = [];
        let handler: FlatMidiEventGenerator = new FlatMidiEventGenerator();
        let generator: MidiFileGenerator = new MidiFileGenerator(score, null, handler);
        generator.generate();
        for (let midiEvent of handler.midiEvents) {
            if (midiEvent instanceof NoteEvent) {
                actualMidiStartTimes.push(midiEvent.tick);
                actualMidiDurations.push(midiEvent.length);
            }
        }
        expect(actualMidiStartTimes.join(',')).toEqual(expectedMidiStartTimes.join(','));
        expect(actualMidiDurations.join(',')).toEqual(expectedMidiDurations.join(','));
    });
});
