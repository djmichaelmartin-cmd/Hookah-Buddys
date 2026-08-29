import { useState } from "react";
import { 
  useGetCurrentUser, 
  useUpdateMyProfile, 
  getGetMyProfileQueryKey,
  getGetCurrentUserQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export function CompleteProfilePrompt() {
  const { data: session } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [buddyType, setBuddyType] = useState<"female_buddy" | "male_buddy" | "">("");

  const updateProfile = useUpdateMyProfile({
    mutation: {
      onSuccess: () => {
        toast({ title: "Profile complete", description: "Buddy Type saved." });
        queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Could not save Buddy Type.", variant: "destructive" });
      }
    }
  });

  if (!session?.authenticated || !session.user) return null;
  if (session.user.role === "admin") return null; // Avoid trapping admins
  if (session.user.buddyType) return null; // Already set

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!buddyType) {
      toast({ title: "Selection required", description: "Please select a Buddy Type.", variant: "destructive" });
      return;
    }
    updateProfile.mutate({ data: { buddyType } });
  };

  return (
    <Dialog open={true} modal={false} onOpenChange={() => {}}>
      <DialogContent 
        className="sm:max-w-md bg-card/95 backdrop-blur-xl border-white/10 top-auto bottom-4 left-4 translate-x-0 translate-y-0 shadow-2xl" 
        onInteractOutside={(e) => e.preventDefault()} 
        onEscapeKeyDown={(e) => e.preventDefault()} 
        hideClose 
        hideOverlay
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-serif text-white">Complete Your Profile</DialogTitle>
          <DialogDescription>
            HookahBuddys now uses a universal Buddy pill on profiles and posts. Please select whether you'd like the Female Buddy (pink) or Male Buddy (blue) style for your account. You can change this later in Edit Profile.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          <div className="space-y-3">
            <Select value={buddyType} onValueChange={(v) => setBuddyType(v as "female_buddy" | "male_buddy")}>
              <SelectTrigger className="bg-background/50 border-white/10">
                <SelectValue placeholder="Select Buddy Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="female_buddy">Female Buddy</SelectItem>
                <SelectItem value="male_buddy">Male Buddy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button 
            type="submit" 
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            disabled={!buddyType || updateProfile.isPending}
          >
            {updateProfile.isPending ? "Saving..." : "Save Selection"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}