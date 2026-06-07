import { Layout } from "@/components/Layout";
import { useGetMemberProfile, getGetMemberProfileQueryKey } from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { User, MapPin, CalendarDays, ArrowLeft } from "lucide-react";

export default function MemberProfile() {
  const { id } = useParams();
  const memberId = parseInt(id || "0", 10);
  const [, navigate] = useLocation();

  const { data: member, isLoading, isError } = useGetMemberProfile(memberId, {
    query: { enabled: !!memberId, queryKey: getGetMemberProfileQueryKey(memberId) },
  });

  if (isLoading)
    return (
      <Layout>
        <div className="container p-12 text-center text-muted-foreground">Loading...</div>
      </Layout>
    );

  if (isError || !member)
    return (
      <Layout>
        <div className="container p-12 text-center text-muted-foreground">Member not found.</div>
      </Layout>
    );

  const location = [member.city, member.state].filter(Boolean).join(", ");
  const memberSince = member.memberSince
    ? new Date(member.memberSince).toLocaleDateString(undefined, { year: "numeric", month: "long" })
    : null;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <Button
          variant="ghost"
          size="sm"
          className="mb-6 text-muted-foreground hover:text-white"
          onClick={() => navigate("/messages")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to messages
        </Button>

        <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="w-32 h-32 rounded-full overflow-hidden border border-white/10 bg-card shrink-0 flex items-center justify-center">
              {member.profilePhotoUrl ? (
                <img src={member.profilePhotoUrl} alt={member.name} className="object-cover w-full h-full" />
              ) : (
                <User className="w-12 h-12 text-muted-foreground/40" />
              )}
            </div>

            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-3xl font-serif text-white font-bold">{member.name}</h1>
              {member.username && <p className="text-primary">@{member.username}</p>}

              <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                {location && (
                  <p className="flex items-center justify-center sm:justify-start gap-2">
                    <MapPin className="w-4 h-4 text-primary" /> {location}
                  </p>
                )}
                {memberSince && (
                  <p className="flex items-center justify-center sm:justify-start gap-2">
                    <CalendarDays className="w-4 h-4 text-primary" /> Member since {memberSince}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
