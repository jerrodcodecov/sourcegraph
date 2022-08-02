package oauth

import (
	"context"
	"strconv"
	"time"

	"github.com/sourcegraph/sourcegraph/internal/database"
	"github.com/sourcegraph/sourcegraph/internal/extsvc/gitlab"
	"github.com/sourcegraph/sourcegraph/internal/httpcli"
	"github.com/sourcegraph/sourcegraph/internal/jsonc"
	"github.com/sourcegraph/sourcegraph/internal/oauthutil"
	"github.com/sourcegraph/sourcegraph/lib/errors"
)

type RefreshTokenHelperForExternalAccount struct {
	DB                database.DB
	ExternalAccountID int32
	OauthRefreshToken string
}

type RefreshTokenHelperForExternalService struct {
	DB                database.DB
	ExternalServiceID int64
	OauthRefreshToken string
}

func (r *RefreshTokenHelperForExternalAccount) RefreshToken(ctx context.Context, doer httpcli.Doer, oauthCtx oauthutil.OauthContext) (string, error) {
	refreshedToken, err := oauthutil.RetrieveToken(ctx, doer, oauthCtx, r.OauthRefreshToken, oauthutil.AuthStyleInParams)

	defer func() {
		success := err == nil
		gitlab.TokenRefreshCounter.WithLabelValues("external_account", strconv.FormatBool(success)).Inc()
	}()

	acct, err := r.DB.UserExternalAccounts().Get(ctx, r.ExternalAccountID)
	if err != nil {
		return "", errors.Wrap(err, "getting user external account")
	}

	acct.SetAuthData(refreshedToken)
	_, err = r.DB.UserExternalAccounts().LookupUserAndSave(ctx, acct.AccountSpec, acct.AccountData)
	if err != nil {
		return "", errors.Wrap(err, "save refreshed token")
	}

	return "", nil
}

func (r *RefreshTokenHelperForExternalService) RefreshToken(ctx context.Context, doer httpcli.Doer, oauthCtx oauthutil.OauthContext) (string, error) {
	refreshedToken, err := oauthutil.RetrieveToken(ctx, doer, oauthCtx, r.OauthRefreshToken, oauthutil.AuthStyleInParams)

	defer func() {
		success := err == nil
		gitlab.TokenRefreshCounter.WithLabelValues("codehost", strconv.FormatBool(success)).Inc()
	}()

	extsvc, err := r.DB.ExternalServices().GetByID(ctx, r.ExternalServiceID)
	if err != nil {
		return "", errors.Wrap(err, "getting external service")
	}
	extsvc.Config, err = jsonc.Edit(extsvc.Config, refreshedToken.AccessToken, "token")
	if err != nil {
		return "", errors.Wrap(err, "updating OAuth token")
	}
	extsvc.Config, err = jsonc.Edit(extsvc.Config, refreshedToken.RefreshToken, "token.oauth.refresh")
	if err != nil {
		return "", errors.Wrap(err, "updating OAuth refresh token")
	}
	extsvc.Config, err = jsonc.Edit(extsvc.Config, refreshedToken.Expiry.Unix(), "token.oauth.expiry")
	if err != nil {
		return "", errors.Wrap(err, "updating OAuth token expiry")
	}
	extsvc.UpdatedAt = time.Now()
	if err := r.DB.ExternalServices().Upsert(ctx, extsvc); err != nil {
		return "", errors.Wrap(err, "upserting external service")
	}

	return "", nil
}
