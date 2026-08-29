import { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { AgeGate } from "./AgeGate";
import { CompleteProfilePrompt } from "./CompleteProfilePrompt";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/30 selection:text-white">
      <div className="fixed inset-0 pointer-events-none opacity-20 mix-blend-screen bg-[radial-gradient(ellipse_at_top_right,var(--primary),transparent_50%),radial-gradient(ellipse_at_bottom_left,var(--secondary),transparent_50%)]" />
      <div className="fixed inset-0 pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03]" />
      
      <Navbar />
      <AgeGate />
      <CompleteProfilePrompt />
      
      <main className="flex-grow flex flex-col relative z-10 w-full">
        {children}
      </main>
      
      <Footer />
    </div>
  );
}
