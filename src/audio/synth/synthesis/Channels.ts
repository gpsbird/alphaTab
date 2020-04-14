// The SoundFont loading and Audio Synthesis is based on TinySoundFont, licensed under MIT,
// developed by Bernhard Schelling (https://github.com/schellingb/TinySoundFont)
// TypeScript port for alphaTab: (C) 2020 by Daniel Kuschny
// Licensed under: MPL-2.0

import { Channel } from '@src/audio/synth/synthesis/Channel';
import { TinySoundFont } from '@src/audio/synth/synthesis/TinySoundFont';
import { Voice } from '@src/audio/synth/synthesis/Voice';

export class Channels {
    public activeChannel: number = 0;
    public channelList: Channel[] = [];

    public setupVoice(tinySoundFont: TinySoundFont, voice: Voice): void {
        const c: Channel = this.channelList[this.activeChannel];
        const newpan: number = voice.region!.pan + c.panOffset;
        voice.playingChannel = this.activeChannel;
        voice.mixVolume = c.mixVolume;
        voice.noteGainDb += c.gainDb;
        voice.calcPitchRatio(
            c.pitchWheel === 8192 ? c.tuning : (c.pitchWheel / 16383.0) * c.pitchRange * 2.0 - c.pitchRange + c.tuning,
            tinySoundFont.outSampleRate
        );
        if (newpan <= -0.5) {
            voice.panFactorLeft = 1.0;
            voice.panFactorRight = 0.0;
        } else if (newpan >= 0.5) {
            voice.panFactorLeft = 0.0;
            voice.panFactorRight = 1.0;
        } else {
            voice.panFactorLeft = Math.sqrt(0.5 - newpan);
            voice.panFactorRight = Math.sqrt(0.5 + newpan);
        }
    }
}
