import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

import { dataOrThrowErrors, gql } from '@sourcegraph/shared/src/graphql/graphql'

import { requestGraphQL } from '../../backend/graphql'
import {
    Scalars,
    ServiceWebhookLogsResult,
    ServiceWebhookLogsVariables,
    WebhookLogConnectionFields,
    WebhookLogsResult,
    WebhookLogsVariables,
} from '../../graphql-operations'

export type SelectedExternalService = 'unmatched' | 'all' | Scalars['ID']

export const queryWebhookLogs = (
    { first, after }: Pick<WebhookLogsVariables, 'first' | 'after'>,
    externalService: SelectedExternalService,
    onlyErrors: boolean
): Observable<WebhookLogConnectionFields> => {
    const fragment = gql`
        fragment WebhookLogConnectionFields on WebhookLogConnection {
            nodes {
                ...WebhookLogFields
            }
            pageInfo {
                hasNextPage
                endCursor
            }
            totalCount
        }

        fragment WebhookLogFields on WebhookLog {
            id
            receivedAt
            externalService {
                displayName
            }
            statusCode
            request {
                ...WebhookLogMessageFields
            }
            response {
                ...WebhookLogMessageFields
            }
        }

        fragment WebhookLogMessageFields on WebhookLogMessage {
            headers {
                name
                values
            }
            body
        }
    `

    if (externalService === 'all' || externalService === 'unmatched') {
        return requestGraphQL<WebhookLogsResult, WebhookLogsVariables>(
            gql`
                query WebhookLogs($first: Int, $after: String, $onlyErrors: Boolean!, $onlyUnmatched: Boolean!) {
                    webhookLogs(first: $first, after: $after, onlyErrors: $onlyErrors, onlyUnmatched: $onlyUnmatched) {
                        ...WebhookLogConnectionFields
                    }
                }

                ${fragment}
            `,
            {
                first,
                after,
                onlyErrors,
                onlyUnmatched: externalService === 'unmatched',
            }
        ).pipe(
            map(dataOrThrowErrors),
            map((result: WebhookLogsResult) => result.webhookLogs)
        )
    }

    return requestGraphQL<ServiceWebhookLogsResult, ServiceWebhookLogsVariables>(
        gql`
            query ServiceWebhookLogs($first: Int, $after: String, $id: ID!, $onlyErrors: Boolean!) {
                node(id: $id) {
                    ... on ExternalService {
                        webhookLogs(first: $first, after: $after, onlyErrors: $onlyErrors) {
                            ...WebhookLogConnectionFields
                        }
                    }
                }
            }

            ${fragment}
        `,
        {
            first: first ?? null,
            after: after ?? null,
            onlyErrors,
            id: externalService,
        }
    ).pipe(
        map(dataOrThrowErrors),
        map(result => {
            if (result.node?.__typename !== 'ExternalService') {
                throw new Error('unexpected non ExternalService node')
            }
            return result.node.webhookLogs
        })
    )
}

export const WEBHOOK_LOG_PAGE_HEADER = gql`
    query WebhookLogPageHeader {
        externalServices {
            nodes {
                id
                displayName
            }
            pageInfo {
                hasNextPage
            }
            totalCount
        }

        webhookLogs(onlyErrors: true) {
            totalCount
        }
    }
`
