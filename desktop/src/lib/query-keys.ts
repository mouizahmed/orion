export const queryKeys = {
  account: (accountID: string) => ['account', accountID] as const,
  vocabulary: (accountID: string) => ['account', accountID, 'vocabulary'] as const,
  calendarSettings: (accountID: string) => ['account', accountID, 'calendar-settings'] as const,
  calendarEvents: (accountID: string) => ['account', accountID, 'calendar-events'] as const,
  billingStatus: (accountID: string) => ['account', accountID, 'billing-status'] as const,
  extractFields: (accountID: string) => ['account', accountID, 'extract-fields'] as const,
  emailDraftSettings: (accountID: string) => ['account', accountID, 'email-draft-settings'] as const,
}
