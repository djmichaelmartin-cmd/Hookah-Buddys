import type { EnhancedProfile } from "@workspace/api-client-react";
import { MapPin, Calendar, Heart, Globe, Instagram, Music2 } from "lucide-react";

interface AboutSectionProps {
  profile: EnhancedProfile;
}

export function AboutSection({ profile }: AboutSectionProps) {
  const details = profile.details;

  if (!details) {
    return (
      <div className="bg-card/30 backdrop-blur-md border border-white/5 rounded-2xl p-12 text-center">
        <p className="text-muted-foreground">
          This information is private or hasn't been shared yet.
        </p>
      </div>
    );
  }

  const hasAnyContent =
    details.description ||
    details.birthMonth ||
    details.birthDay ||
    details.gender ||
    details.languagesSpoken ||
    details.hairColor ||
    details.eyeColor ||
    details.bodyType ||
    details.height ||
    details.favoriteHookahFlavor ||
    details.favoriteHookahLounge ||
    details.favoriteHookahBrand ||
    details.hookahExperienceLevel ||
    details.interests?.length ||
    details.livesInCity ||
    details.fromCity ||
    Object.keys(details.socialLinks || {}).length;

  if (!hasAnyContent) {
    return (
      <div className="bg-card/30 backdrop-blur-md border border-white/5 rounded-2xl p-12 text-center">
        <p className="text-muted-foreground">No public information shared.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview */}
      {details.description && (
        <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-serif text-white mb-3">Overview</h3>
          <p className="text-white/80 whitespace-pre-wrap">{details.description}</p>
        </div>
      )}

      {/* Personal Details */}
      {(details.birthMonth ||
        details.birthDay ||
        details.gender ||
        details.languagesSpoken) && (
        <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-serif text-white mb-4">Personal Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {details.birthMonth && details.birthDay && (
              <DetailRow
                icon={<Calendar className="w-4 h-4 text-primary" />}
                label="Birthday"
                value={`${getMonthName(details.birthMonth)} ${details.birthDay}`}
              />
            )}
            {details.gender && (
              <DetailRow
                icon={<Heart className="w-4 h-4 text-primary" />}
                label="Gender"
                value={details.gender}
              />
            )}
            {details.languagesSpoken && (
              <DetailRow
                icon={<Globe className="w-4 h-4 text-primary" />}
                label="Languages"
                value={details.languagesSpoken}
              />
            )}
          </div>
        </div>
      )}

      {/* Appearance */}
      {(details.hairColor ||
        details.eyeColor ||
        details.bodyType ||
        details.height) && (
        <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-serif text-white mb-4">Appearance</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {details.hairColor && (
              <DetailRow label="Hair Color" value={details.hairColor} />
            )}
            {details.eyeColor && (
              <DetailRow label="Eye Color" value={details.eyeColor} />
            )}
            {details.bodyType && (
              <DetailRow label="Body Type" value={details.bodyType} />
            )}
            {details.height && (
              <DetailRow label="Height" value={details.height} />
            )}
          </div>
        </div>
      )}

      {/* Hookah Details */}
      {(details.favoriteHookahFlavor ||
        details.favoriteHookahLounge ||
        details.favoriteHookahBrand ||
        details.hookahExperienceLevel ||
        details.preferredHookahStyle ||
        details.favoriteSmokeSessionVibe ||
        details.favoriteHookahAccessories ||
        details.openToLoungeMeetups ||
        details.favoriteLoungeCity) && (
        <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-serif text-white mb-4">Hookah Preferences</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {details.favoriteHookahFlavor && (
              <DetailRow label="Favorite Flavor" value={details.favoriteHookahFlavor} />
            )}
            {details.favoriteHookahLounge && (
              <DetailRow label="Favorite Lounge" value={details.favoriteHookahLounge} />
            )}
            {details.favoriteHookahBrand && (
              <DetailRow label="Favorite Brand" value={details.favoriteHookahBrand} />
            )}
            {details.hookahExperienceLevel && (
              <DetailRow label="Experience Level" value={details.hookahExperienceLevel} />
            )}
            {details.preferredHookahStyle && (
              <DetailRow label="Preferred Style" value={details.preferredHookahStyle} />
            )}
            {details.favoriteSmokeSessionVibe && (
              <DetailRow label="Session Vibe" value={details.favoriteSmokeSessionVibe} />
            )}
            {details.favoriteHookahAccessories && (
              <DetailRow label="Accessories" value={details.favoriteHookahAccessories} />
            )}
            {details.openToLoungeMeetups && (
              <DetailRow
                label="Open to Meetups"
                value={details.openToLoungeMeetups}
              />
            )}
            {details.favoriteLoungeCity && (
              <DetailRow
                label="Favorite Lounge City"
                value={details.favoriteLoungeCity}
              />
            )}
          </div>
        </div>
      )}

      {/* Interests */}
      {details.interests && details.interests.length > 0 && (
        <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-serif text-white mb-4">Interests</h3>
          <div className="flex flex-wrap gap-2">
            {details.interests.map((interest, i) => (
              <span
                key={i}
                className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white hover:bg-white/10 transition-colors"
              >
                {interest}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Places Lived */}
      {(details.livesInCity || details.fromCity) && (
        <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-serif text-white mb-4">Places Lived</h3>
          <div className="space-y-3">
            {details.livesInCity && (
              <div className="flex items-center gap-2 text-white/80">
                <MapPin className="w-4 h-4 text-primary" />
                <span>Lives in {details.livesInCity}</span>
              </div>
            )}
            {details.fromCity && (
              <div className="flex items-center gap-2 text-white/80">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <span>From {details.fromCity}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Social Links */}
      {details.socialLinks && Object.keys(details.socialLinks).length > 0 && (
        <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-serif text-white mb-4">Social Links</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(details.socialLinks).map(([platform, url]) => (
              <a
                key={platform}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-primary/40 transition-all"
              >
                {getSocialIcon(platform)}
                <span className="text-sm capitalize">{platform}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      {icon && <div className="mt-0.5">{icon}</div>}
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-white font-medium">{value}</p>
      </div>
    </div>
  );
}

function getMonthName(month: number): string {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return months[month - 1] || "";
}

function getSocialIcon(platform: string) {
  switch (platform.toLowerCase()) {
    case "instagram":
      return <Instagram className="w-4 h-4" />;
    case "tiktok":
      return <Music2 className="w-4 h-4" />;
    default:
      return <Globe className="w-4 h-4" />;
  }
}
