import { FC, useEffect, useState, memo } from 'react'

import { mdiArrowExpand } from '@mdi/js'

import { SearchAggregationMode, SearchPatternType } from '@sourcegraph/shared/src/schema'
import { TelemetryProps } from '@sourcegraph/shared/src/telemetry/telemetryService'
import { Button, Icon } from '@sourcegraph/wildcard'

import { NotAvailableReasonType } from '../../../graphql-operations'
import {
    AggregationChartCard,
    AggregationModeControls,
    AggregationLimitLabel,
    AggregationUIMode,
    useAggregationSearchMode,
    useAggregationUIMode,
    useSearchAggregationData,
    isNonExhaustiveAggregationResults,
    GroupResultsPing,
} from '../components/aggregation'

import styles from './SearchAggregations.module.scss'

interface SearchAggregationsProps extends TelemetryProps {
    /**
     * Current submitted query, note that this query isn't a live query
     * that is synced with typed query in the search box, this query is submitted
     * see `searchQueryFromURL` state in the global query Zustand store.
     */
    query: string

    /** Current search query pattern type. */
    patternType: SearchPatternType

    /** Whether to proactively load and display search aggregations */
    proactive: boolean

    caseSensitive: boolean

    /**
     * Emits whenever a user clicks one of aggregation chart segments (bars).
     * That should update the query and re-trigger search (but this should be connected
     * to this UI through its consumer)
     */
    onQuerySubmit: (newQuery: string) => void
}

export const SearchAggregations: FC<SearchAggregationsProps> = memo(props => {
    const { query, patternType, proactive, caseSensitive, telemetryService, onQuerySubmit } = props

    const [extendedTimeout, setExtendedTimeoutLocal] = useState(false)

    const [, setAggregationUIMode] = useAggregationUIMode()
    const [aggregationMode, setAggregationMode] = useAggregationSearchMode()
    const { data, error, loading } = useSearchAggregationData({
        query,
        patternType,
        aggregationMode,
        proactive,
        caseSensitive,
        extendedTimeout,
    })

    // When query is updated reset extendedTimeout as per business rules
    useEffect(() => setExtendedTimeoutLocal(false), [query])

    useEffect(
        function proactiveModePings() {
            if (loading || error || !data.searchQueryAggregate.aggregations) {
                return
            }

            const aggregation = data.searchQueryAggregate.aggregations
            const aggregationType = aggregation.__typename
            const aggregationAvailable =
                aggregationType === 'ExhaustiveSearchAggregationResult' ||
                aggregationType === 'NonExhaustiveSearchAggregationResult'
            const aggregationUnavailable = aggregationType === 'SearchAggregationNotAvailable'

            let pingType

            if (aggregationUnavailable) {
                const extensionAvailable = aggregation.reasonType === NotAvailableReasonType.TIMEOUT_EXTENSION_AVAILABLE
                const noExtensionAvailable =
                    aggregation.reasonType === NotAvailableReasonType.TIMEOUT_NO_EXTENSION_AVAILABLE

                if (proactive && extensionAvailable) {
                    pingType = GroupResultsPing.ProactiveLimitHit
                }

                if (noExtensionAvailable) {
                    pingType = GroupResultsPing.ExplicitLimitHit
                }
            }

            if (aggregationAvailable) {
                if (proactive) {
                    pingType = GroupResultsPing.ProactiveLimitSuccess
                }

                if (extendedTimeout) {
                    pingType = GroupResultsPing.ExplicitLimitSuccess
                }
            }

            if (pingType) {
                telemetryService.log(
                    pingType,
                    { aggregationMode, uiMode: 'sidebar' },
                    { aggregationMode, uiMode: 'sidebar' }
                )
            }
        },
        [aggregationMode, data, error, extendedTimeout, loading, proactive, telemetryService]
    )

    const handleExtendTimeout = (): void => setExtendedTimeoutLocal(true)

    const handleBarLinkClick = (query: string, index: number): void => {
        onQuerySubmit(query)
        telemetryService.log(
            GroupResultsPing.ChartBarClick,
            { aggregationMode, index, uiMode: 'sidebar' },
            { aggregationMode, index, uiMode: 'sidebar' }
        )
    }

    const handleBarHover = (): void => {
        telemetryService.log(
            GroupResultsPing.ChartBarHover,
            { aggregationMode, uiMode: 'sidebar' },
            { aggregationMode, uiMode: 'sidebar' }
        )
    }

    const handleExpandClick = (): void => {
        setAggregationUIMode(AggregationUIMode.SearchPage)
        telemetryService.log(GroupResultsPing.ExpandFullViewPanel, { aggregationMode }, { aggregationMode })
    }

    const handleAggregationModeChange = (mode: SearchAggregationMode): void => {
        setAggregationMode(mode)
        telemetryService.log(
            GroupResultsPing.ModeClick,
            { aggregationMode: mode, uiMode: 'sidebar' },
            { aggregationMode: mode, uiMode: 'sidebar' }
        )
    }

    const handleAggregationModeHover = (aggregationMode: SearchAggregationMode, available: boolean): void => {
        if (!available) {
            telemetryService.log(
                GroupResultsPing.ModeDisabledHover,
                { aggregationMode, uiMode: 'sidebar' },
                { aggregationMode, uiMode: 'sidebar' }
            )
        }
    }

    return (
        <article className="pt-2">
            <AggregationModeControls
                availability={data?.searchQueryAggregate?.modeAvailability}
                loading={loading}
                mode={aggregationMode}
                size="sm"
                onModeChange={handleAggregationModeChange}
                onModeHover={handleAggregationModeHover}
            />

            {(proactive || aggregationMode !== null) && (
                <>
                    <AggregationChartCard
                        aria-label="Sidebar search aggregation chart"
                        data={data?.searchQueryAggregate?.aggregations}
                        loading={loading}
                        error={error}
                        mode={aggregationMode}
                        showLoading={extendedTimeout}
                        className={styles.chartContainer}
                        onBarLinkClick={handleBarLinkClick}
                        onBarHover={handleBarHover}
                        onExtendTimeout={handleExtendTimeout}
                    />

                    <footer className={styles.actions}>
                        <Button
                            variant="secondary"
                            size="sm"
                            outline={true}
                            className={styles.detailsAction}
                            data-testid="expand-aggregation-ui"
                            onClick={handleExpandClick}
                        >
                            <Icon aria-hidden={true} svgPath={mdiArrowExpand} /> Expand
                        </Button>

                        {isNonExhaustiveAggregationResults(data) && <AggregationLimitLabel size="sm" />}
                    </footer>
                </>
            )}
        </article>
    )
})

SearchAggregations.displayName = 'SearchAggregations'
