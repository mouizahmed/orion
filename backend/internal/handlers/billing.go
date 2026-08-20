package handlers

import (
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/billing"
	"github.com/mouizahmed/justscribe-backend/internal/middleware"
)

type BillingHandler struct {
	checkout *billing.CheckoutService
	portal   *billing.PortalService
	status   *billing.StatusService
	webhook  *billing.WebhookService
}

func NewBillingHandler(
	checkout *billing.CheckoutService,
	portal *billing.PortalService,
	status *billing.StatusService,
	webhook *billing.WebhookService,
) *BillingHandler {
	return &BillingHandler{checkout: checkout, portal: portal, status: status, webhook: webhook}
}

func (h *BillingHandler) CreatePortalSession(c *gin.Context) {
	principal, ok := middleware.GetPrincipal(c)
	if !ok || principal.User == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication is required."})
		return
	}
	portalURL, err := h.portal.Create(c.Request.Context(), principal.User)
	if err != nil {
		switch {
		case errors.Is(err, billing.ErrSubscriptionConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "No billing account is available to manage."})
		case errors.Is(err, billing.ErrRateLimited):
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many billing requests. Try again shortly."})
		default:
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Billing is unavailable."})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": portalURL})
}

func (h *BillingHandler) GetStatus(c *gin.Context) {
	principal, ok := middleware.GetPrincipal(c)
	if !ok || principal.User == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication is required."})
		return
	}
	status, err := h.status.Get(c.Request.Context(), principal.User)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Billing status is unavailable."})
		return
	}
	c.JSON(http.StatusOK, status)
}

func (h *BillingHandler) ReceiveStripeWebhook(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, billing.WebhookBodyLimit)
	payload, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook request."})
		return
	}
	_, err = h.webhook.Receive(c.Request.Context(), payload, c.GetHeader("Stripe-Signature"), time.Now().UTC())
	if err != nil {
		if errors.Is(err, billing.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook request."})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Webhook receipt is unavailable."})
		return
	}
	c.Status(http.StatusOK)
}

func (h *BillingHandler) CreateCheckoutSession(c *gin.Context) {
	principal, ok := middleware.GetPrincipal(c)
	if !ok || principal.User == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication is required."})
		return
	}
	var request struct {
		Offer     billing.OfferKey `json:"offer" binding:"required"`
		RequestID string           `json:"request_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A valid offer and request_id are required."})
		return
	}
	checkoutURL, err := h.checkout.Create(c.Request.Context(), principal.User, request.Offer, request.RequestID)
	if err != nil {
		switch {
		case errors.Is(err, billing.ErrInvalidRequest):
			c.JSON(http.StatusBadRequest, gin.H{"error": "The billing request is invalid."})
		case errors.Is(err, billing.ErrSubscriptionConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "Manage the existing subscription before starting Checkout."})
		case errors.Is(err, billing.ErrCheckoutInProgress):
			c.JSON(http.StatusConflict, gin.H{"error": "Checkout is already in progress. Try again shortly."})
		case errors.Is(err, billing.ErrRateLimited):
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many billing requests. Try again shortly."})
		default:
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Billing is unavailable."})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": checkoutURL})
}
