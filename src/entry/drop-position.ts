import { EditorView } from "@codemirror/view";
import { Editor, EditorPosition, editorInfoField } from "obsidian";

/**
 * Document position under the pointer of a drop into `editor`, from public
 * APIs only: the CodeMirror view is found from the event target, checked to
 * be the view of `editor` (editorInfoField), and asked for the position at
 * the pointer (posAtCoords, imprecise: the nearest position, never null).
 * Returns null when the drop did not land in `editor`'s view.
 */
export function dropPosition(evt: DragEvent, editor: Editor): EditorPosition | null {
  // Not `instanceof Element`: a popout window has its own Element
  const target = evt.target as Partial<Element> | null;
  const editorEl = target?.closest?.(".cm-editor");
  if (!editorEl) return null;
  const view = EditorView.findFromDOM(editorEl as HTMLElement);
  if (!view || view.state.field(editorInfoField, false)?.editor !== editor) return null;
  const offset = view.posAtCoords({ x: evt.clientX, y: evt.clientY }, false);
  return editor.offsetToPos(offset);
}
