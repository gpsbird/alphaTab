import { IWriteable } from '@src/io/IWriteable';

/**
 * Lists all midi events.
 */
export enum MidiEventType {
    /**
     * A note is released.
     */
    NoteOff = 128,

    /**
     * A note is started.
     */
    NoteOn = 144,

    /**
     * The pressure that was used to play the note.
     */
    NoteAftertouch = 160,

    /**
     * Change of a midi controller
     */
    Controller = 176,

    /**
     * Change of a midi program
     */
    ProgramChange = 192,

    /**
     * The pressure that should be applied to the whole channel.
     */
    ChannelAftertouch = 208,

    /**
     * A change of the audio pitch.
     */
    PitchBend = 224,

    /**
     * A meta event.
     */
    Meta = 255
}

/**
 * Represents a midi event.
 */
export class MidiEvent {
    /**
     * Gets or sets the raw midi message.
     */
    public message: number;

    /**
     * Gets or sets the absolute tick of this midi event.
     */
    public tick: number;

    public get channel(): number {
        return this.message & 0x000000f;
    }

    public get command(): MidiEventType {
        return (this.message & 0x00000f0) as MidiEventType;
    }

    public get data1(): number {
        return (this.message & 0x000ff00) >> 8;
    }

    public set data1(value: number) {
        this.message &= ~0x000ff00;
        this.message |= value << 8;
    }

    public get data2(): number {
        return (this.message & 0x0ff0000) >> 16;
    }

    public set data2(value: number) {
        this.message &= ~0x0ff0000;
        this.message |= value << 16;
    }

    /**
     * Initializes a new instance of the {@link MidiEvent} class.
     * @param tick The absolute midi ticks of this event..
     * @param status The status information of this event.
     * @param data1 The first data component of this midi event.
     * @param data2 The second data component of this midi event.
     */
    public constructor(tick: number, status: number, data1: number, data2: number) {
        this.tick = tick;
        this.message = status | (data1 << 8) | (data2 << 16);
    }

    /**
     * Writes the midi event as binary into the given stream.
     * @param s The stream to write to.
     */
    public writeTo(s: IWriteable): void {
        let b: Uint8Array = new Uint8Array([
            (this.message >> 24) & 0xff,
            (this.message >> 16) & 0xff,
            (this.message >> 8) & 0xff,
            this.message & 0xff
        ]);
        s.write(b, 0, b.length);
    }
}
