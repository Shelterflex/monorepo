import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ThemeToggle } from "@/components/theme-toggle"

const tokenRows = [
  { name: "Primary", token: "--primary", sampleClass: "bg-primary" },
  { name: "Secondary", token: "--secondary", sampleClass: "bg-secondary" },
  { name: "Accent", token: "--accent", sampleClass: "bg-accent" },
  { name: "Muted", token: "--muted", sampleClass: "bg-muted" },
]

export default function DesignSystemPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="ds-container py-8 md:py-12 lg:py-16 ds-stack ds-reveal">
        <header className="rounded-xl border-4 border-foreground bg-card p-5 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)] md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Frontend Design System
              </p>
              <h1 className="text-2xl font-black md:text-4xl">Mobile-First Components</h1>
              <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
                Responsive tokens and reusable component variants for primary, secondary,
                outline, and ghost interactions.
              </p>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <section className="ds-grid-responsive">
          <Card className="border-4 border-foreground shadow-[6px_6px_0px_0px_rgba(26,26,26,1)]">
            <CardHeader>
              <CardTitle>Button Variants</CardTitle>
              <CardDescription>Primary, secondary, outline, and ghost variants.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
            </CardContent>
            <CardFooter className="text-sm text-muted-foreground">
              Min touch target size remains mobile-friendly.
            </CardFooter>
          </Card>

          <Card className="border-4 border-foreground shadow-[6px_6px_0px_0px_rgba(26,26,26,1)]">
            <CardHeader>
              <CardTitle>Responsive Inputs</CardTitle>
              <CardDescription>Consistent spacing and typography scale across breakpoints.</CardDescription>
            </CardHeader>
            <CardContent className="ds-stack">
              <Input placeholder="Email address" className="border-3 border-foreground" />
              <Input placeholder="Phone number" className="border-3 border-foreground" />
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button className="w-full sm:w-auto">Submit</Button>
                <Button variant="outline" className="w-full sm:w-auto">Cancel</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-4 border-foreground shadow-[6px_6px_0px_0px_rgba(26,26,26,1)]">
            <CardHeader>
              <CardTitle>Theme Tokens</CardTitle>
              <CardDescription>Light and dark themes powered by shared CSS variables.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {tokenRows.map((token) => (
                <div key={token.token} className="flex items-center justify-between rounded-md border-2 border-foreground p-2">
                  <div>
                    <p className="text-sm font-semibold">{token.name}</p>
                    <p className="text-xs text-muted-foreground">{token.token}</p>
                  </div>
                  <div className={`h-8 w-14 rounded-sm border-2 border-foreground ${token.sampleClass}`} />
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="rounded-xl border-4 border-foreground bg-muted p-5 md:p-8">
          <h2 className="text-xl font-black md:text-2xl">Breakpoints</h2>
          <p className="mt-2 text-sm text-muted-foreground md:text-base">
            Mobile: up to 767px, Tablet: 768px to 1199px, Desktop: 1200px and above.
            Resize this page to see the card grid adapt from 1 to 2 to 3 columns.
          </p>
        </section>
      </section>
    </main>
  )
}
