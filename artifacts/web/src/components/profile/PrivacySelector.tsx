import { Globe, Users, Eye, Lock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type PrivacyVisibility = "public" | "friends" | "followers" | "only_me";

interface PrivacySelectorProps {
  value: PrivacyVisibility;
  onChange: (value: PrivacyVisibility) => void;
  className?: string;
}

export function PrivacySelector({ value, onChange, className }: PrivacySelectorProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`w-32 h-8 text-xs bg-background/50 border-white/10 ${className}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-card border-white/10">
        <SelectItem value="public" className="text-xs cursor-pointer hover:bg-white/5">
          <div className="flex items-center gap-2">
            <Globe className="w-3 h-3 text-primary" />
            Public
          </div>
        </SelectItem>
        <SelectItem value="friends" className="text-xs cursor-pointer hover:bg-white/5">
          <div className="flex items-center gap-2">
            <Users className="w-3 h-3 text-primary" />
            Friends
          </div>
        </SelectItem>
        <SelectItem value="followers" className="text-xs cursor-pointer hover:bg-white/5">
          <div className="flex items-center gap-2">
            <Eye className="w-3 h-3 text-primary" />
            Followers
          </div>
        </SelectItem>
        <SelectItem value="only_me" className="text-xs cursor-pointer hover:bg-white/5">
          <div className="flex items-center gap-2">
            <Lock className="w-3 h-3 text-primary" />
            Only me
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

export function getPrivacyIcon(visibility: PrivacyVisibility) {
  switch (visibility) {
    case "public":
      return <Globe className="w-3 h-3 text-muted-foreground" />;
    case "friends":
      return <Users className="w-3 h-3 text-muted-foreground" />;
    case "followers":
      return <Eye className="w-3 h-3 text-muted-foreground" />;
    case "only_me":
      return <Lock className="w-3 h-3 text-muted-foreground" />;
  }
}
