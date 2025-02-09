import React from 'react'

import * as GQL from '@sourcegraph/shared/src/schema'

import { formatUserCount } from '../../../productSubscription/helpers'

/**
 * Displays a text label with the product name (e.g., "Sourcegraph Enterprise") and user count for the
 * subscription.
 */
export const ProductSubscriptionLabel: React.FunctionComponent<
    React.PropsWithChildren<{
        productSubscription: Pick<GQL.IProductSubscription, 'activeLicense'>

        className?: string
    }>
> = ({ productSubscription, className = '' }) => (
    <span className={className}>
        {productSubscription.activeLicense?.info ? (
            <>
                {productSubscription.activeLicense.info.productNameWithBrand} (
                {formatUserCount(productSubscription.activeLicense.info.userCount)})
            </>
        ) : (
            <span className="text-muted font-italic">No plan selected</span>
        )}
    </span>
)
