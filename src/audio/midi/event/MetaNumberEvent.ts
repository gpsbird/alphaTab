import { MetaEvent } from '@src/audio/midi/event/MetaEvent';
import { MidiFile } from '@src/audio/midi/MidiFile';
import { IWriteable } from '@src/io/IWriteable';

export class MetaNumberEvent extends MetaEvent {
    public value: number;

    public constructor(delta: number, status: number, metaId: number, value: number) {
        super(delta, status, metaId, 0);
        this.value = value;
    }

    public writeTo(s: IWriteable): void {
        s.writeByte(0xff);
        s.writeByte(this.metaStatus);
        MidiFile.writeVariableInt(s, 3);
        let b: Uint8Array = new Uint8Array([(this.value >> 16) & 0xff, (this.value >> 8) & 0xff, this.value & 0xff]);
        s.write(b, 0, b.length);
    }
}
