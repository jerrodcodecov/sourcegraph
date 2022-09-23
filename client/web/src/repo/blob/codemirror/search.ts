/**
 * This extension exends CodeMirro's own search extension with a custom search
 * UI.
 */

import {
    findNext,
    findPrevious,
    getSearchQuery,
    search as codemirrorSearch,
    searchKeymap,
    SearchQuery,
    setSearchQuery,
} from '@codemirror/search'
import { Extension } from '@codemirror/state'
import { EditorView, keymap, Panel, runScopeHandlers, ViewUpdate } from '@codemirror/view'
import { mdiChevronDown, mdiChevronUp } from '@mdi/js'

import { createSVGIcon } from '@sourcegraph/shared/src/util/dom'
import { ButtonStyles, LabelStyles } from '@sourcegraph/wildcard'

import { createElement } from '../../../util/dom'

class SearchPanel implements Panel {
    public dom: HTMLElement
    public top = true
    private query: SearchQuery
    private input: HTMLInputElement
    private caseSensitive: HTMLInputElement
    private regex: HTMLInputElement

    constructor(private view: EditorView) {
        const previous = createElement(
            'button',
            {
                type: 'button',
                className: [ButtonStyles.btn, ButtonStyles.btnSm, ButtonStyles.btnOutlineSecondary].join(' '),
                onclick: () => findPrevious(view),
            },
            createSVGIcon(mdiChevronUp),
            'Previous'
        )
        const next = createElement(
            'button',
            {
                type: 'button',
                className: [ButtonStyles.btn, ButtonStyles.btnSm, ButtonStyles.btnOutlineSecondary].join(' '),
                onclick: () => findNext(view),
            },
            createSVGIcon(mdiChevronDown),
            'Next'
        )

        this.input = createElement('input', {
            name: 'search',
            placeholder: 'Find...',
            className: 'form-control form-control-sm',
            onchange: this.commit,
            onkeyup: this.commit,
        })
        this.input.setAttribute('main-field', 'true')

        this.caseSensitive = createElement('input', { type: 'checkbox', onchange: this.commit })
        this.regex = createElement('input', { type: 'checkbox', onchange: this.commit })

        this.dom = createElement(
            'div',
            { className: 'search-container', onkeydown: this.onkeydown },
            this.input,
            previous,
            next,
            createElement(
                'label',
                { className: `form-check-label small mx-2 ml-3 ${LabelStyles.label}` },
                this.caseSensitive,
                ' Match case'
            ),
            createElement(
                'label',
                { className: `form-check-label small mx-2 ${LabelStyles.label}` },
                this.regex,
                ' Regexp'
            )
        )

        this.query = getSearchQuery(this.view.state)

        this.setQuery(this.query)
    }

    public update(update: ViewUpdate): void {
        const currentQuery = getSearchQuery(update.state)
        if (!currentQuery.eq(getSearchQuery(update.startState))) {
            this.setQuery(currentQuery)
        }
    }

    public mount(): void {
        this.input.focus()
        this.input.select()
    }

    // Taken from CodeMirror's default serach panel implementation. This is
    // necessary so that pressing Meta+F (and other CodeMirror keybindings) will
    // trigger the configured event handlers and not just fall back to the
    // browser's default behavior.
    private onkeydown = (event: KeyboardEvent): void => {
        if (runScopeHandlers(this.view, event, 'search-panel')) {
            event.preventDefault()
        } else if (event.keyCode === 13 && event.target === this.input) {
            event.preventDefault()
            if (event.shiftKey) {
                findPrevious(this.view)
            } else {
                findNext(this.view)
            }
        }
    }

    private commit = (): void => {
        const query = new SearchQuery({
            search: this.input.value,
            caseSensitive: this.caseSensitive.checked,
            regexp: this.regex.checked,
        })

        if (!query.eq(this.query)) {
            this.view.dispatch({ effects: setSearchQuery.of(query) })
        }
    }

    private setQuery(query: SearchQuery): void {
        this.query = query
        this.input.value = this.query.search
        this.caseSensitive.checked = this.query.caseSensitive
        this.regex.checked = this.query.regexp
    }
}

export const search: Extension = [
    EditorView.theme({
        '.search-container': {
            backgroundColor: 'var(--code-bg)',
            display: 'flex',
            alignItems: 'center',
            padding: '0.25rem',
        },
        '.search-container > *': {
            margin: '0 0.25rem',
        },
        '.search-container > input.form-control': {
            width: '15rem',
        },
        '.search-container > input[type="checkbox"]': {
            verticalAlign: 'text-bottom',
        },
        '.search-container svg': {
            width: 'var(--icon-inline-size)',
            height: 'var(--icon-inline-size)',
            boxSizing: 'border-box',
            textAlign: 'center',
            marginRight: '0.25rem',
            // The icons contain whitespace themselves, this makes the button
            // look more centered
            marginLeft: '-0.125rem',
            verticalAlign: 'text-bottom',
        },
    }),
    keymap.of(searchKeymap),
    codemirrorSearch({
        createPanel: view => new SearchPanel(view),
    }),
]
