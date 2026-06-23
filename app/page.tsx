import { ConnectWalletButton } from '@/components/auth/ConnectWalletButton'
import { NetworkGuard } from '@/components/auth/NetworkGuard'

export default function HomePage() {
  return (
    <>
      <header className="flex items-center justify-between border-b border-white/5 px-7 py-4">
        <div className="font-semibold">Arc Lepton</div>
        <ConnectWalletButton />
      </header>
      <NetworkGuard />
      <main className="p-12 text-center">
        <h1 className="text-2xl">Arc Lepton — placeholder</h1>
        <p className="mt-4 text-white/60">
          访问{' '}
          <a href="/login" className="text-arc underline underline-offset-4">
            /login
          </a>{' '}
          体验登录流程
        </p>
      </main>
    </>
  )
}
