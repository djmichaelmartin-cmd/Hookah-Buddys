import { CheckCircle2, Circle } from "lucide-react";

interface ProfileCompletionMeterProps {
  percent: number;
  missing: string[];
}

export function ProfileCompletionMeter({ percent, missing }: ProfileCompletionMeterProps) {
  return (
    <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-serif text-white">Profile Completion</h3>
        <span className="text-2xl font-bold text-primary tabular-nums">{percent}%</span>
      </div>
      
      <div className="h-2 rounded-full bg-white/5 overflow-hidden mb-4">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      
      {missing.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground mb-2">Add these to complete your profile:</p>
          {missing.map((field) => (
            <div key={field} className="flex items-center gap-2 text-sm text-white/70">
              <Circle className="w-4 h-4 text-muted-foreground" />
              <span className="capitalize">{field.replace(/_/g, " ")}</span>
            </div>
          ))}
        </div>
      )}
      
      {missing.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle2 className="w-5 h-5" />
          <span>Your profile is complete!</span>
        </div>
      )}
    </div>
  );
}
