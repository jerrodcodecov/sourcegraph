package batches

import (
	"context"

	"github.com/sourcegraph/sourcegraph/cmd/frontend/enterprise"
	"github.com/sourcegraph/sourcegraph/enterprise/cmd/frontend/internal/batches/httpapi"
	"github.com/sourcegraph/sourcegraph/enterprise/cmd/frontend/internal/batches/resolvers"
	"github.com/sourcegraph/sourcegraph/enterprise/cmd/frontend/internal/batches/webhooks"
	"github.com/sourcegraph/sourcegraph/enterprise/internal/batches/store"
	"github.com/sourcegraph/sourcegraph/enterprise/internal/batches/types/scheduler/window"
	"github.com/sourcegraph/sourcegraph/internal/conf"
	"github.com/sourcegraph/sourcegraph/internal/conf/conftypes"
	"github.com/sourcegraph/sourcegraph/internal/database"
	"github.com/sourcegraph/sourcegraph/internal/encryption/keyring"
	"github.com/sourcegraph/sourcegraph/internal/observation"
)

// Init initializes the given enterpriseServices to include the required
// resolvers for Batch Changes and sets up webhook handlers for changeset
// events.
func Init(ctx context.Context, db database.DB, _ conftypes.UnifiedWatchable, enterpriseServices *enterprise.Services, observationContext *observation.Context) error {
	// Validate site configuration.
	conf.ContributeValidator(func(c conftypes.SiteConfigQuerier) (problems conf.Problems) {
		if _, err := window.NewConfiguration(c.SiteConfig().BatchChangesRolloutWindows); err != nil {
			problems = append(problems, conf.NewSiteProblem(err.Error()))
		}

		return
	})

	// Initialize store.
	bstore := store.New(db, observationContext, keyring.Default().BatchChangesCredentialKey)

	// Register enterprise services.
	enterpriseServices.BatchChangesResolver = resolvers.New(bstore)
	enterpriseServices.GitHubWebhook = webhooks.NewGitHubWebhook(bstore)
	enterpriseServices.BitbucketServerWebhook = webhooks.NewBitbucketServerWebhook(bstore)
	enterpriseServices.BitbucketCloudWebhook = webhooks.NewBitbucketCloudWebhook(bstore)
	enterpriseServices.GitLabWebhook = webhooks.NewGitLabWebhook(bstore)
	operations := httpapi.NewOperations(observationContext)
	enterpriseServices.BatchesFileHandler = httpapi.NewFileHandler(db, bstore, operations)

	return nil
}
