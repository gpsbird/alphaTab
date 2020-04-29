import { Beat } from '@src/model/Beat';
import { Ottavia } from '@src/model/Ottavia';
import { BarRendererBase } from '@src/rendering/BarRendererBase';
import { EffectBarGlyphSizing } from '@src/rendering/EffectBarGlyphSizing';
import { EffectGlyph } from '@src/rendering/glyphs/EffectGlyph';
import { OttavaGlyph } from '@src/rendering/glyphs/OttavaGlyph';
import { IEffectBarRendererInfo } from '@src/rendering/IEffectBarRendererInfo';
import { Settings } from '@src/Settings';

export class OttaviaEffectInfo implements IEffectBarRendererInfo {
    private _aboveStaff: boolean;

    public get effectId(): string {
        return 'ottavia-' + (this._aboveStaff ? 'above' : 'below');
    }

    public get hideOnMultiTrack(): boolean {
        return false;
    }

    public get canShareBand(): boolean {
        return true;
    }

    public get sizingMode(): EffectBarGlyphSizing {
        return EffectBarGlyphSizing.GroupedOnBeat;
    }

    public constructor(aboveStaff: boolean) {
        this._aboveStaff = aboveStaff;
    }

    public shouldCreateGlyph(settings: Settings, beat: Beat): boolean {
        switch (beat.ottava) {
            case Ottavia._15ma:
                return this._aboveStaff;
            case Ottavia._8va:
                return this._aboveStaff;
            case Ottavia._8vb:
                return !this._aboveStaff;
            case Ottavia._15mb:
                return !this._aboveStaff;
        }
        return false;
    }

    public createNewGlyph(renderer: BarRendererBase, beat: Beat): EffectGlyph {
        return new OttavaGlyph(beat.ottava, this._aboveStaff);
    }

    public canExpand(from: Beat, to: Beat): boolean {
        return from.ottava === to.ottava;
    }
}
