package billing

import "errors"

var (
	ErrUnavailable          = errors.New("billing is unavailable")
	ErrInvalidRequest       = errors.New("billing request is invalid")
	ErrCheckoutInProgress   = errors.New("Checkout is already in progress")
	ErrSubscriptionConflict = errors.New("an existing subscription must be managed before starting Checkout")
	ErrRateLimited          = errors.New("too many billing requests")
)
