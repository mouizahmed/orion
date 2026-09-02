import { DesktopAuthRoot } from '@/features/auth/AuthContext'
import WelcomeView from '@/features/onboarding/WelcomeView'

export default function AuthApp() {
  return (
    <DesktopAuthRoot>
      <WelcomeView />
    </DesktopAuthRoot>
  )
}
