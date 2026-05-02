import type { OnboardingStep } from '@/components/onboarding/types'
import {
  IntegrationsVisual,
  LargeLogoVisual,
  LiveInsightsVisual,
  MeetingVisual,
  OverlayNotepadVisual,
} from '@/components/onboarding/visuals'

export const authOnboardingSteps: OnboardingStep[] = [
  {
    title: 'Welcome to Orionly',
    description:
      'Your private AI notepad for calls. Orionly captures meetings and helps turn them into clear notes, follow-ups, and answers.',
    visualAlign: 'center',
    visual: <LargeLogoVisual />,
  },
  {
    title: 'We show up when your meeting starts',
    description:
      'Orionly opens when your call begins and works across meeting apps without joining as a bot.',
    visual: <MeetingVisual />,
  },
  {
    title: 'Take notes without managing windows',
    description:
      'Keep a small notepad in the overlay so you can write things down while working in the background.',
    visual: <OverlayNotepadVisual />,
  },
  {
    title: 'Get live insights from your context',
    description:
      'Orionly can use the notes, docs, and details you provide to surface timely answers and reminders during the call.',
    visual: <LiveInsightsVisual />,
  },
  {
    title: 'Send follow-ups faster',
    description: 'Turn calls into summaries, CRM updates, and draft emails right after the meeting.',
    visual: <IntegrationsVisual />,
  },
  {
    id: 'sign-in',
    title: 'Sign in to get started',
    visualAlign: 'center',
    visual: <LargeLogoVisual />,
  },
]
