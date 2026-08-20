package models

import (
	"time"
)

type UserPlan string
type UserStatus string

const (
	UserPlanFree     UserPlan = "free"
	UserPlanPro      UserPlan = "professional"
	UserPlanBusiness UserPlan = "business"

	UserStatusActive    UserStatus = "active"
	UserStatusSuspended UserStatus = "suspended"
	UserStatusDeleted   UserStatus = "deleted"
)

type User struct {
	ID        string     `json:"id" db:"id"`
	Email     string     `json:"email" db:"email"`
	Name      string     `json:"name" db:"name"`
	AvatarURL *string    `json:"avatar_url" db:"avatar_url"`
	Plan      UserPlan   `json:"plan" db:"effective_plan_key"`
	Status    UserStatus `json:"status" db:"status"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
	DeletedAt *time.Time `json:"deleted_at,omitempty" db:"deleted_at"`
}
