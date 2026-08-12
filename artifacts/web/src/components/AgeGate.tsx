import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function AgeGate() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const isVerified = localStorage.getItem("ageVerified");
    if (!isVerified) {
      setOpen(true);
    }
  }, []);

  const handleConfirm = () => {
    localStorage.setItem("ageVerified", "true");
    setOpen(false);
  };

  const handleDeny = () => {
    window.location.href = "https://www.google.com";
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md bg-card/90 backdrop-blur-xl border-primary/20 shadow-[0_0_50px_rgba(255,36,46,0.15)] text-center sm:text-left">
        <DialogHeader>
          <DialogTitle className="text-2xl text-primary font-serif tracking-wider uppercase text-center mb-2">Age Verification</DialogTitle>
          <DialogDescription className="text-muted-foreground text-center text-base">
            HookahDolls.com is a premium platform centered on hookah culture and nightlife lifestyle. You must be 21 years of age or older to enter.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-6">
          <Button onClick={handleConfirm} size="lg" className="w-full bg-gradient-to-r from-primary to-rose-400 hover:from-primary/90 hover:to-rose-400/90 text-primary-foreground font-semibold tracking-wide shadow-[0_0_20px_rgba(255,36,46,0.3)] border-none">
            I AM 21 OR OLDER
          </Button>
          <Button onClick={handleDeny} variant="outline" size="lg" className="w-full border-border/50 text-muted-foreground hover:bg-white/5 hover:text-white">
            I AM UNDER 21
          </Button>
        </div>
        <p className="text-xs text-muted-foreground/60 text-center mt-4">
          By entering, you agree to our Terms of Service and acknowledge that hookah and tobacco use is for adults only.
        </p>
      </DialogContent>
    </Dialog>
  );
}
