import { JsonConverter } from '@src/model/JsonConverter';
import { Score } from '@src/model/Score';
import { IWorkerScope } from '@src/platform/javaScript/IWorkerScope';
import { FontSizes } from '@src/platform/svg/FontSizes';
import { ScoreRenderer } from '@src/rendering/ScoreRenderer';
import { Settings } from '@src/Settings';
import { Logger } from '@src/util/Logger';

export class AlphaTabWebWorker {
    private _renderer!: ScoreRenderer;
    private _main: IWorkerScope;

    public constructor(main: IWorkerScope) {
        this._main = main;
        this._main.addEventListener('message', this.handleMessage.bind(this), false);
    }

    public static init(): void {
        (globalThis as any).alphaTabWebWorker = new AlphaTabWebWorker((globalThis as unknown) as IWorkerScope);
    }

    private handleMessage(e: MessageEvent): void {
        let data: any = e.data;
        let cmd: any = data ? data.cmd : '';
        switch (cmd) {
            case 'alphaTab.initialize':
                let settings: Settings = new Settings();
                settings.fillFromJson(data.settings);
                Logger.logLevel = settings.core.logLevel;
                this._renderer = new ScoreRenderer(settings);
                this._renderer.partialRenderFinished.on(result => {
                    this._main.postMessage({
                        cmd: 'alphaTab.partialRenderFinished',
                        result: result
                    });
                });
                this._renderer.renderFinished.on(result => {
                    this._main.postMessage({
                        cmd: 'alphaTab.renderFinished',
                        result: result
                    });
                });
                this._renderer.postRenderFinished.on(() => {
                    this._main.postMessage({
                        cmd: 'alphaTab.postRenderFinished',
                        boundsLookup: this._renderer.boundsLookup?.toJson() ?? null
                    });
                });
                this._renderer.preRender.on(resize => {
                    this._main.postMessage({
                        cmd: 'alphaTab.preRender',
                        resize: resize
                    });
                });
                this._renderer.error.on(this.error.bind(this));
                break;
            case 'alphaTab.invalidate':
                this._renderer.render();
                break;
            case 'alphaTab.resizeRender':
                this._renderer.resizeRender();
                break;
            case 'alphaTab.setWidth':
                this._renderer.width = data.width;
                break;
            case 'alphaTab.renderScore':
                this.updateFontSizes(data.fontSizes);
                let score: any = JsonConverter.jsObjectToScore(data.score, this._renderer.settings);
                this.renderMultiple(score, data.trackIndexes);
                break;
            case 'alphaTab.updateSettings':
                this.updateSettings(data.settings);
                break;
        }
    }

    private updateFontSizes(fontSizes: any): void {
        if (fontSizes) {
            if (!FontSizes.FontSizeLookupTables) {
                FontSizes.FontSizeLookupTables = new Map<string, Uint8Array>();
            }
            for (let font in fontSizes) {
                FontSizes.FontSizeLookupTables.set(font, fontSizes[font]);
            }
        }
    }

    private updateSettings(json: unknown): void {
        this._renderer.settings.fillFromJson(json);
    }

    private renderMultiple(score: Score, trackIndexes: Int32Array): void {
        try {
            this._renderer.renderScore(score, trackIndexes);
        } catch (e) {
            this.error('render', e);
        }
    }

    private error(type: string, e: any): void {
        Logger.error(type, 'An unexpected error occurred in worker', e);
        let error: any = JSON.parse(JSON.stringify(e));
        if (e.message) {
            error.message = e.message;
        }
        if (e.stack) {
            error.stack = e.stack;
        }
        if (e.constructor && e.constructor.name) {
            error.type = e.constructor.name;
        }
        this._main.postMessage({
            cmd: 'alphaTab.error',
            error: {
                type: type,
                detail: error
            }
        });
    }
}
