import { Line, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { OperatorFunction, pipe } from 'rxjs'
import { scan, distinctUntilChanged } from 'rxjs/operators'

import { Position } from '@sourcegraph/extension-api-types'
import { UIPositionSpec, UIRangeSpec } from '@sourcegraph/shared/src/util/url'

/**
 * Returns true of any of the document offset ranges contains the provided
 * point.
 */
export function rangesContain(ranges: readonly { from: number; to: number }[], point: number): boolean {
    return ranges.some(range => range.from <= point && range.to >= point)
}

/**
 * Converts 0-based line/character positions to document offsets.
 * Returns null if the position cannot be mapped to a valid offset within the
 * document.
 */
export function positionToOffset(textDocument: Text, position: Position): number | null {
    // Position is 0-based
    const lineNumber = position.line + 1
    if (lineNumber > textDocument.lines) {
        return null
    }
    const line = textDocument.line(lineNumber)
    const offset = line.from + position.character

    return offset <= line.to ? offset : null
}

/*
 * Converts 1-based line/character positions to document offsets.
 * Returns null if the position cannot be mapped to a valid offset within the
 * document.
 */
export function uiPositionToOffset(
    textDocument: Text,
    position: UIPositionSpec['position'],
    line?: Line
): number | null {
    const lineNumber = position.line
    if (lineNumber > textDocument.lines) {
        return null
    }
    if (!line) {
        line = textDocument.line(position.line)
    }
    const offset = line.from + position.character - 1

    return offset <= line.to ? offset : null
}

/**
 * Converts document offsets to 1-based line/character positions.
 */
export function offsetToUIPosition(textDocument: Text, from: number): UIPositionSpec['position']
export function offsetToUIPosition(textDocument: Text, from: number, to: number): UIRangeSpec['range']
export function offsetToUIPosition(
    textDocument: Text,
    from: number,
    to?: number
): UIRangeSpec['range'] | UIPositionSpec['position'] {
    const startLine = textDocument.lineAt(from)
    const startCharacter = from - startLine.from + 1

    const startPosition: Position = {
        line: startLine.number,
        character: startCharacter,
    }

    if (to !== undefined) {
        const endLine = to <= startLine.to ? startLine : textDocument.lineAt(to)
        const endCharacter = to - endLine.from + 1

        return {
            start: startPosition,
            end: {
                line: endLine.number,
                character: endCharacter,
            },
        }
    }

    return startPosition
}

export function viewPortChanged(
    previous: { from: number; to: number } | null,
    next: { from: number; to: number }
): boolean {
    return previous?.from !== next.from || previous.to !== next.to
}

export function sortRangeValuesByStart<T extends { range: { start: Position } }>(values: T[]): T[] {
    return values.sort(({ range: rangeA }, { range: rangeB }) =>
        rangeA.start.line === rangeB.start.line
            ? rangeA.start.character - rangeB.start.character
            : rangeA.start.line - rangeB.start.line
    )
}

/**
 * Returns the document offset at the provided coordindates or null if there is
 * no text underneath these coordinates.
 *
 * It seems when using `posAtCoords` CodeMirror returns the document position
 * _closest_ to the coordinates. This has the unfortunate effect that hovering
 * over empty parts a line will find the position of the closest character next
 * to it, which we do not want.
 * To ensure that we only consider positions of actual words/characters we
 * perform the inverse conversion and compare the results.
 * This is also done by CodeMirror's own hover tooltip plugin.
 */
export function preciseOffsetAtCoords(view: EditorView, coords: { x: number; y: number }): number | null {
    const offset = view.posAtCoords(coords)
    if (offset === null) {
        return null
    }
    const offsetCords = view.coordsAtPos(offset)
    if (
        offsetCords === null ||
        coords.y < offsetCords.top ||
        coords.y > offsetCords.bottom ||
        coords.x < offsetCords.left - view.defaultCharacterWidth ||
        coords.x > offsetCords.right + view.defaultCharacterWidth
    ) {
        return null
    }
    return offset
}

/**
 * Helper operator to find the distinct position of words at coordinates. Used
 * together with mousemove events.
 */
export function distinctWordAtCoords(
    view: EditorView
): OperatorFunction<{ x: number; y: number }, { from: number; to: number } | null> {
    return pipe(
        scan((position: { from: number; to: number } | null, coords) => {
            const offset = preciseOffsetAtCoords(view, coords)

            if (offset === null) {
                return null
            }

            // Still hovering over the same word
            if (position && position.from <= offset && position.to >= offset) {
                return position
            }

            {
                const word = view.state.wordAt(offset)
                // Update position if we are hovering over a
                // different word
                if (word) {
                    return { from: word.from, to: word.to }
                }
            }

            return null
        }, null),
        distinctUntilChanged()
    )
}

/**
 * Verifies that the provided 1-based range is within the document range.
 */
export function isValidLineRange(
    range: { line: number; character?: number; endLine?: number; endCharacter?: number },
    textDocument: Text
): boolean {
    const { lines } = textDocument

    // Return early if the document doesn't have as many lines
    if ((range.endLine ?? range.line) > lines) {
        return false
    }

    {
        // Some juggling to make Typescript happy (passing range directly
        // doesn't work)
        const { character, line } = range
        if (character && uiPositionToOffset(textDocument, { line, character }) === null) {
            return false
        }
    }

    if (range.endLine && range.endCharacter) {
        return uiPositionToOffset(textDocument, { line: range.endLine, character: range.endCharacter }) !== null
    }

    return true
}
