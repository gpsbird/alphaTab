import { StaveProfile } from '@src/DisplaySettings';
import { Settings } from '@src/Settings';
import { VisualTestHelper } from '@test/visualTests/VisualTestHelper';

describe('GeneralTests', () => {
    it('song-details', async () => {
        await VisualTestHelper.runVisualTest('features/general/song-details.gp5');
    });

    it('repeats', async () => {
        let settings: Settings = new Settings();
        settings.display.staveProfile = StaveProfile.Score;
        await VisualTestHelper.runVisualTest('features/general/repeats.gp5', settings);
    });

    it('alternate-endings', async () => {
        let settings: Settings = new Settings();
        settings.display.staveProfile = StaveProfile.Score;
        await VisualTestHelper.runVisualTest('features/general/alternate-endings.gp5', settings);
    });

    it('tuning', async () => {
        await VisualTestHelper.runVisualTest('features/general/tuning.gp5');
    });
});
