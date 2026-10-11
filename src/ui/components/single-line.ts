// A multi-line field that holds one line of text. Pure module: must not import "obsidian".

/** The text of a field and where its caret is. */
export interface FieldText {
    value: string;
    /** Offset of the caret in `value` */
    caret: number;
}

const LINE_BREAKS = /[\r\n\u2028\u2029]/g;
const HAS_LINE_BREAK = /[\r\n\u2028\u2029]/;

/**
 * `value` with its line breaks removed, and the caret moved back by the
 * breaks that stood before it. A name wraps in its field to be read whole;
 * a line break would be part of the name.
 */
export function withoutLineBreaks(value: string, caret: number): FieldText {
    const before = value.slice(0, caret).replace(LINE_BREAKS, "");
    const after = value.slice(caret).replace(LINE_BREAKS, "");
    return { value: before + after, caret: before.length };
}

/** The part of an input event the field reads and stops. */
interface LineBreakInput {
    inputType: string;
    preventDefault(): void;
}

/** The part of a textarea kept to one line. */
interface SingleLineSource {
    value: string;
    selectionStart: number | null;
    setSelectionRange(start: number, end: number): void;
    addEventListener(type: "beforeinput", listener: (e: LineBreakInput) => void): void;
    addEventListener(type: "input", listener: () => void): void;
}

/**
 * Keeps `field` to one line, the text wrapping inside it: no key or IME
 * inserts a line break (an Enter the form takes is listened for apart,
 * listenFormEnter), and a paste or a drop that brings line breaks loses
 * them. Register it before the field's other input listeners, so that
 * they read the value without breaks.
 */
export function keepSingleLine(field: SingleLineSource): void {
    field.addEventListener("beforeinput", (e) => {
        if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") e.preventDefault();
    });
    field.addEventListener("input", () => {
        if (!HAS_LINE_BREAK.test(field.value)) return;
        const text = withoutLineBreaks(field.value, field.selectionStart ?? field.value.length);
        field.value = text.value;
        field.setSelectionRange(text.caret, text.caret);
    });
}
