import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import SignupDoll from "@/pages/SignupDoll";
import SignupMember from "@/pages/SignupMember";
import ChooseMembership from "@/pages/ChooseMembership";
import Browse from "@/pages/Browse";
import Lounges from "@/pages/Lounges";
import DollProfile from "@/pages/DollProfile";
import MemberProfile from "@/pages/MemberProfile";
import MembersDirectory from "@/pages/MembersDirectory";
import Pricing from "@/pages/Pricing";
import DashboardDoll from "@/pages/DashboardDoll";
import DashboardMember from "@/pages/DashboardMember";
import AdminDashboard from "@/pages/AdminDashboard";
import Upload from "@/pages/Upload";
import Verification from "@/pages/Verification";
import Checkout from "@/pages/Checkout";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";
import ContentRules from "@/pages/ContentRules";
import RefundPolicy from "@/pages/RefundPolicy";
import Contact from "@/pages/Contact";
import Messages from "@/pages/Messages";
import VideoChat from "@/pages/VideoChat";
import Feed from "@/pages/Feed";
import PostDetail from "@/pages/PostDetail";
import Notifications from "@/pages/Notifications";
import BroProfile from "@/pages/BroProfile";
import ProfileEdit from "@/pages/ProfileEdit";
import PrivacySettings from "@/pages/PrivacySettings";
import Friends from "@/pages/Friends";
import SparksDiscover from "@/pages/sparks/SparksDiscover";
import SparkCreate from "@/pages/sparks/SparkCreate";
import SparkDetail from "@/pages/sparks/SparkDetail";
import GroupsDiscover from "@/pages/groups/GroupsDiscover";
import GroupCreate from "@/pages/groups/GroupCreate";
import GroupDetail from "@/pages/groups/GroupDetail";
import DashboardGroups from "@/pages/dashboard/DashboardGroups";
import { usePresenceHeartbeatLoop } from "@/hooks/use-presence-heartbeat";
import { useGuardedBrowserLocation } from "@/hooks/use-unsaved-changes-warning";
import Events from "@/pages/Events";
import EventDetail from "@/pages/EventDetail";
import CommunityFeed from "@/pages/CommunityFeed";
import BusinessDiscover from "@/pages/BusinessDiscover";
import BusinessCreate from "@/pages/BusinessCreate";
import BusinessProfile from "@/pages/BusinessProfile";
import BusinessDashboard from "@/pages/BusinessDashboard";

import MeetupsDiscover from "@/pages/meetups/MeetupsDiscover";
import MeetupCreate from "@/pages/meetups/MeetupCreate";
import MeetupDetail from "@/pages/meetups/MeetupDetail";
import MeetupCreateEvent from "@/pages/meetups/MeetupCreateEvent";
import DashboardMeetups from "@/pages/dashboard/DashboardMeetups";

const queryClient = new QueryClient();

function PresenceHeartbeat() {
  usePresenceHeartbeatLoop();
  return null;
}

function ScrollToTopOnNavigation() {
  const [location] = useLocation();
  const previousLocation = useRef(location);

  useEffect(() => {
    if (previousLocation.current === location) return;
    previousLocation.current = location;
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location]);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/signup/doll" component={SignupDoll} />
      <Route path="/signup/member" component={SignupMember} />
      <Route path="/signup/bro" component={SignupMember} />
      <Route path="/choose-membership" component={ChooseMembership} />
      <Route path="/browse" component={Browse} />
      <Route path="/lounges" component={Lounges} />
      <Route path="/dolls/:id" component={DollProfile} />
      <Route path="/bros/:id" component={BroProfile} />
      <Route path="/members" component={MembersDirectory} />
      <Route path="/members/:id" component={MemberProfile} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/dashboard/doll" component={DashboardDoll} />
      <Route path="/dashboard/member" component={DashboardMember} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/:section" component={AdminDashboard} />
      <Route path="/upload" component={Upload} />
      <Route path="/verification" component={Verification} />
      <Route path="/checkout" component={Checkout} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/content-rules" component={ContentRules} />
      <Route path="/refund-policy" component={RefundPolicy} />
      <Route path="/contact" component={Contact} />
      <Route path="/messages" component={Messages} />
      <Route path="/video-chat" component={VideoChat} />
      <Route path="/video-chat/:id" component={VideoChat} />
      <Route path="/feed" component={Feed} />
      <Route path="/posts/:id" component={PostDetail} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/profile/edit" component={ProfileEdit} />
      <Route path="/settings/privacy" component={PrivacySettings} />
      <Route path="/friends" component={Friends} />
      <Route path="/sparks" component={SparksDiscover} />
      <Route path="/sparks/create" component={SparkCreate} />
      <Route path="/sparks/:id" component={SparkDetail} />
      <Route path="/events" component={Events} />
      <Route path="/events/:id" component={EventDetail} />

      {/* Group Routes */}
      <Route path="/groups" component={GroupsDiscover} />
      <Route path="/groups/create" component={GroupCreate} />
      <Route path="/groups/:id" component={GroupDetail} />
      <Route path="/groups/:id/:tab" component={GroupDetail} />
      <Route path="/dashboard/groups" component={DashboardGroups} />

      {/* Meetups Routes */}
      <Route path="/meetups" component={MeetupsDiscover} />
      <Route path="/meetups/create" component={MeetupCreate} />
      <Route path="/meetups/:id/create-event" component={MeetupCreateEvent} />
      <Route path="/meetups/:id" component={MeetupDetail} />
      <Route path="/meetups/:id/:tab" component={MeetupDetail} />
      <Route path="/dashboard/meetups" component={DashboardMeetups} />

      {/* Legacy topic routes and backward-compatible redirects */}
      <Route path="/communities"><Redirect to="/groups" /></Route>
      <Route path="/communities/create"><Redirect to="/groups/create" /></Route>
      <Route path="/communities/:id">{({id}) => <Redirect to={`/groups/${id}`} />}</Route>

      <Route path="/reels"><Redirect to="/sparks" /></Route>
      <Route path="/reels/create"><Redirect to="/sparks/create" /></Route>
      <Route path="/reels/:id">{({id}) => <Redirect to={`/sparks/${id}`} />}</Route>

      <Route path="/community/hookah-setups" component={CommunityFeed} />
      <Route path="/community/favorite-flavors" component={CommunityFeed} />
      <Route path="/community/lounge-reviews" component={CommunityFeed} />
      <Route path="/community/smoke-talk" component={CommunityFeed} />
      <Route path="/community/hookah-memes" component={CommunityFeed} />
      <Route path="/community/questions" component={CommunityFeed} />
      <Route path="/community/hookah-events" component={Events} />
      <Route path="/community/local-lounges" component={Lounges} />

      {/* Business Pages */}
      <Route path="/businesses" component={BusinessDiscover} />
      <Route path="/business/create" component={BusinessCreate} />
      <Route path="/business/:handle" component={BusinessProfile} />
      <Route path="/dashboard/business/:handle" component={BusinessDashboard} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter
          base={import.meta.env.BASE_URL.replace(/\/$/, "")}
          hook={useGuardedBrowserLocation}
        >
          <PresenceHeartbeat />
          <ScrollToTopOnNavigation />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
