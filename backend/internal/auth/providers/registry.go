package providers

import "github.com/mouizahmed/justscribe-backend/internal/models"

type Registry struct {
	providers map[models.AuthProvider]AuthProvider
}

func NewRegistry(providers ...AuthProvider) *Registry {
	registry := &Registry{
		providers: make(map[models.AuthProvider]AuthProvider, len(providers)),
	}
	for _, provider := range providers {
		registry.providers[provider.Name()] = provider
	}
	return registry
}

func NewDefaultRegistry() *Registry {
	return NewRegistry(
		NewGoogleProvider(),
		NewMicrosoftProvider(),
	)
}

func (r *Registry) Get(provider models.AuthProvider) (AuthProvider, bool) {
	if r == nil {
		return nil, false
	}
	p, ok := r.providers[provider]
	return p, ok
}
