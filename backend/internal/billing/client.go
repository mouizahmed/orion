package billing

import "github.com/stripe/stripe-go/v86"

type Runtime struct {
	config Config
	client *stripe.Client
}

func NewRuntime(config Config) *Runtime {
	runtime := &Runtime{config: config}
	if config.Enabled {
		runtime.client = stripe.NewClient(config.APIKey)
	}
	return runtime
}

func (r *Runtime) Enabled() bool {
	return r != nil && r.config.Enabled && r.client != nil
}

func (r *Runtime) Mode() Mode {
	if r == nil {
		return ""
	}
	return r.config.Mode
}
