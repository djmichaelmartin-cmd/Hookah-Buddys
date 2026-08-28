import { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/Layout";
import { useLocation } from "wouter";
import {
  useGetMyProfile,
  useUpdateMyProfile,
  useGetEnhancedProfileAsPublic,
  getGetMyProfileQueryKey,
  type ProfileUpdateInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PrivacySelector, type PrivacyVisibility } from "@/components/profile/PrivacySelector";
import { InterestTags } from "@/components/profile/InterestTags";
import { ProfileCompletionMeter } from "@/components/profile/ProfileCompletionMeter";
import { Camera, Loader2, Eye, Save, Upload as UploadIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { uploadImage, ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE_BYTES } from "@/lib/uploadImage";

const SUGGESTED_INTERESTS = [
  "Hookah",
  "Lounges",
  "Music",
  "Nightlife",
  "Food",
  "Travel",
  "Fitness",
  "Cars",
  "Fashion",
  "Beauty",
  "Sports",
  "Gaming",
  "Business",
  "Events",
  "Photography",
  "Dancing",
  "Art",
  "Culture",
  "Movies",
];

const MONTHS = [
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

type FieldPrivacyMap = Record<string, PrivacyVisibility>;

export default function ProfileEdit() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  const coverPhotoInputRef = useRef<HTMLInputElement>(null);

  const { data: myProfile, isLoading } = useGetMyProfile({
    query: { queryKey: getGetMyProfileQueryKey() },
  });

  const [profilePhoto, setProfilePhoto] = useState("");
  const [coverPhoto, setCoverPhoto] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [description, setDescription] = useState("");
  const [livesInCity, setLivesInCity] = useState("");
  const [livesInState, setLivesInState] = useState("");
  const [fromCity, setFromCity] = useState("");
  const [fromState, setFromState] = useState("");
  const [birthMonth, setBirthMonth] = useState<number | undefined>();
  const [birthDay, setBirthDay] = useState<number | undefined>();
  const [gender, setGender] = useState("");
  const [languagesSpoken, setLanguagesSpoken] = useState("");
  const [hairColor, setHairColor] = useState("");
  const [eyeColor, setEyeColor] = useState("");
  const [bodyType, setBodyType] = useState("");
  const [height, setHeight] = useState("");
  const [favoriteHookahFlavor, setFavoriteHookahFlavor] = useState("");
  const [favoriteHookahLounge, setFavoriteHookahLounge] = useState("");
  const [favoriteHookahBrand, setFavoriteHookahBrand] = useState("");
  const [hookahExperienceLevel, setHookahExperienceLevel] = useState("");
  const [preferredHookahStyle, setPreferredHookahStyle] = useState("");
  const [favoriteSmokeSessionVibe, setFavoriteSmokeSessionVibe] = useState("");
  const [favoriteHookahAccessories, setFavoriteHookahAccessories] = useState("");
  const [openToLoungeMeetups, setOpenToLoungeMeetups] = useState("");
  const [favoriteLoungeCity, setFavoriteLoungeCity] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({});

  const [fieldPrivacy, setFieldPrivacy] = useState<FieldPrivacyMap>({});

  // UI privacy keys that map to different backend field names
  const PRIVACY_KEY_TO_FIELDS: Record<string, string[]> = {
    city: ["livesInCity"],
    state: ["livesInState"],
    birthday: ["birthMonth", "birthDay"],
    languages: ["languagesSpoken"],
  };
  const FIELD_TO_PRIVACY_KEY: Record<string, string> = {
    livesInCity: "city",
    livesInState: "state",
    birthMonth: "birthday",
    birthDay: "birthday",
    languagesSpoken: "languages",
  };

  useEffect(() => {
    if (myProfile) {
      setProfilePhoto(myProfile.profilePhotoUrl || "");
      setName(myProfile.name || "");
      setUsername(myProfile.username || "");
      
      if (myProfile.details) {
        const d = myProfile.details;
        setCoverPhoto(d.coverPhotoUrl || "");
        setDescription(d.description || "");
        setLivesInCity(d.livesInCity || "");
        setLivesInState(d.livesInState || "");
        setFromCity(d.fromCity || "");
        setFromState(d.fromState || "");
        setBirthMonth(d.birthMonth || undefined);
        setBirthDay(d.birthDay || undefined);
        setGender(d.gender || "");
        setLanguagesSpoken(d.languagesSpoken || "");
        setHairColor(d.hairColor || "");
        setEyeColor(d.eyeColor || "");
        setBodyType(d.bodyType || "");
        setHeight(d.height || "");
        setFavoriteHookahFlavor(d.favoriteHookahFlavor || "");
        setFavoriteHookahLounge(d.favoriteHookahLounge || "");
        setFavoriteHookahBrand(d.favoriteHookahBrand || "");
        setHookahExperienceLevel(d.hookahExperienceLevel || "");
        setPreferredHookahStyle(d.preferredHookahStyle || "");
        setFavoriteSmokeSessionVibe(d.favoriteSmokeSessionVibe || "");
        setFavoriteHookahAccessories(d.favoriteHookahAccessories || "");
        setOpenToLoungeMeetups(d.openToLoungeMeetups || "");
        setFavoriteLoungeCity(d.favoriteLoungeCity || "");
        setInterests(d.interests || []);
        setSocialLinks(d.socialLinks || {});
      }

      const privacyMap: FieldPrivacyMap = {};
      (myProfile.fieldPrivacy || []).forEach((fp) => {
        const uiKey = FIELD_TO_PRIVACY_KEY[fp.fieldName] ?? fp.fieldName;
        privacyMap[uiKey] = fp.visibility as PrivacyVisibility;
      });
      setFieldPrivacy(privacyMap);
    }
  }, [myProfile]);

  const updateProfile = useUpdateMyProfile({
    mutation: {
      onSuccess: () => {
        toast({ title: "Profile updated", description: "Your changes have been saved." });
        queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      },
      onError: () => toast({ title: "Failed to update profile", variant: "destructive" }),
    },
  });

  const validateImageFile = (file: File): boolean => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast({
        title: "Unsupported file type",
        description: "Please choose a JPEG, PNG, WebP, GIF, or AVIF image.",
        variant: "destructive",
      });
      return false;
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      toast({
        title: "File too large",
        description: "Images must be 10 MB or smaller.",
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const [isUploadingProfile, setIsUploadingProfile] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);

  const handleImageUpload = async (
    file: File,
    setUploading: (v: boolean) => void,
    setUrl: (url: string) => void,
  ) => {
    setUploading(true);
    try {
      setUrl(await uploadImage(file));
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleProfilePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !validateImageFile(file)) return;
    await handleImageUpload(file, setIsUploadingProfile, setProfilePhoto);
  };

  const handleCoverPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !validateImageFile(file)) return;
    await handleImageUpload(file, setIsUploadingCover, setCoverPhoto);
  };

  const handleSave = () => {
    const input: ProfileUpdateInput = {
      name,
      username,
      profilePhotoUrl: profilePhoto,
      details: {
        coverPhotoUrl: coverPhoto,
        description,
        livesInCity,
        livesInState,
        fromCity,
        fromState,
        birthMonth,
        birthDay,
        gender,
        languagesSpoken,
        hairColor,
        eyeColor,
        bodyType,
        height,
        favoriteHookahFlavor,
        favoriteHookahLounge,
        favoriteHookahBrand,
        hookahExperienceLevel,
        preferredHookahStyle,
        favoriteSmokeSessionVibe,
        favoriteHookahAccessories,
        openToLoungeMeetups,
        favoriteLoungeCity,
        interests,
        socialLinks,
      },
      fieldPrivacy: Object.entries(fieldPrivacy).flatMap(([uiKey, visibility]) =>
        (PRIVACY_KEY_TO_FIELDS[uiKey] ?? [uiKey]).map((fieldName) => ({
          fieldName,
          visibility,
        })),
      ),
    };

    updateProfile.mutate({ data: input });
  };

  const handleViewAsPublic = () => {
    const params = new URLSearchParams({ viewAs: "public" });
    navigate(`/bros/${myProfile?.userId}?${params}`);
  };

  const setSocialLink = (platform: string, url: string) => {
    setSocialLinks({ ...socialLinks, [platform]: url });
  };

  const getPrivacy = (field: string): PrivacyVisibility => {
    return fieldPrivacy[field] || "public";
  };

  const setPrivacy = (field: string, visibility: PrivacyVisibility) => {
    setFieldPrivacy({ ...fieldPrivacy, [field]: visibility });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 flex justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-serif text-white">Edit Profile</h1>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleViewAsPublic}
              className="border-white/20 text-white hover:bg-white/10 rounded-full px-6"
            >
              <Eye className="w-4 h-4 mr-2" /> View As Public
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateProfile.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-8 font-semibold shadow-[0_0_20px_rgba(24,119,242,0.3)]"
            >
              {updateProfile.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" /> Save Changes
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            {/* Profile Images */}
            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-serif text-white mb-6">Profile Images</h2>
              <div className="space-y-6">
                <div>
                  <Label htmlFor="profilePhoto">Profile Photo</Label>
                  <div className="flex items-center gap-4 mt-2">
                    <Avatar className="w-24 h-24 border-4 border-white/10">
                      <AvatarImage src={profilePhoto} />
                      <AvatarFallback className="bg-background text-primary text-2xl font-serif">
                        {name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <input
                        ref={profilePhotoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleProfilePhotoChange}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => profilePhotoInputRef.current?.click()}
                        disabled={isUploadingProfile}
                        className="w-full border-white/20 text-white hover:bg-white/10"
                      >
                        {isUploadingProfile ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...
                          </>
                        ) : (
                          <>
                            <UploadIcon className="w-4 h-4 mr-2" /> Upload Photo
                          </>
                        )}
                      </Button>
                      <p className="text-xs text-muted-foreground mt-2">
                        Click to upload a new profile photo
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="coverPhoto">Cover Photo</Label>
                  <div className="mt-2">
                    {coverPhoto && (
                      <div className="rounded-lg overflow-hidden border border-white/10 mb-3">
                        <img
                          src={coverPhoto}
                          alt="Cover preview"
                          className="w-full h-32 object-cover"
                        />
                      </div>
                    )}
                    <input
                      ref={coverPhotoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleCoverPhotoChange}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => coverPhotoInputRef.current?.click()}
                      disabled={isUploadingCover}
                      className="w-full border-white/20 text-white hover:bg-white/10"
                    >
                      {isUploadingCover ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...
                        </>
                      ) : (
                        <>
                          <UploadIcon className="w-4 h-4 mr-2" /> Upload Cover Photo
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Basic Info */}
            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-serif text-white mb-6">Basic Info</h2>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="name">Display Name</Label>
                    <PrivacySelector
                      value={getPrivacy("name")}
                      onChange={(v) => setPrivacy("name", v)}
                    />
                  </div>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-background/50 border-white/10"
                  />
                </div>

                <div>
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="bg-background/50 border-white/10 mt-2"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="description">Bio / Description</Label>
                    <PrivacySelector
                      value={getPrivacy("description")}
                      onChange={(v) => setPrivacy("description", v)}
                    />
                  </div>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    placeholder="Tell people about yourself..."
                    className="bg-background/50 border-white/10"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="livesInCity">Lives in City</Label>
                      <PrivacySelector
                        value={getPrivacy("city")}
                        onChange={(v) => setPrivacy("city", v)}
                      />
                    </div>
                    <Input
                      id="livesInCity"
                      value={livesInCity}
                      onChange={(e) => setLivesInCity(e.target.value)}
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="livesInState">State</Label>
                      <PrivacySelector
                        value={getPrivacy("state")}
                        onChange={(v) => setPrivacy("state", v)}
                      />
                    </div>
                    <Input
                      id="livesInState"
                      value={livesInState}
                      onChange={(e) => setLivesInState(e.target.value)}
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                </div>
                <p className="text-xs text-white/50">
                  Your saved city and state can be resolved privately on the server
                  to find nearby lounges. If the location is unclear, Spotlight will
                  ask you to check these fields instead of guessing.
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="fromCity">From City</Label>
                      <PrivacySelector
                        value={getPrivacy("fromCity")}
                        onChange={(v) => setPrivacy("fromCity", v)}
                      />
                    </div>
                    <Input
                      id="fromCity"
                      value={fromCity}
                      onChange={(e) => setFromCity(e.target.value)}
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="fromState">State</Label>
                      <PrivacySelector
                        value={getPrivacy("fromState")}
                        onChange={(v) => setPrivacy("fromState", v)}
                      />
                    </div>
                    <Input
                      id="fromState"
                      value={fromState}
                      onChange={(e) => setFromState(e.target.value)}
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Birth Month</Label>
                      <PrivacySelector
                        value={getPrivacy("birthday")}
                        onChange={(v) => setPrivacy("birthday", v)}
                      />
                    </div>
                    <Select
                      value={birthMonth?.toString()}
                      onValueChange={(v) => setBirthMonth(parseInt(v, 10))}
                    >
                      <SelectTrigger className="bg-background/50 border-white/10">
                        <SelectValue placeholder="Select month" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-white/10">
                        {MONTHS.map((month, i) => (
                          <SelectItem key={i} value={(i + 1).toString()}>
                            {month}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="birthDay">Day</Label>
                    <Input
                      id="birthDay"
                      type="number"
                      min="1"
                      max="31"
                      value={birthDay || ""}
                      onChange={(e) =>
                        setBirthDay(e.target.value ? parseInt(e.target.value, 10) : undefined)
                      }
                      className="bg-background/50 border-white/10 mt-2"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Gender</Label>
                    <PrivacySelector
                      value={getPrivacy("gender")}
                      onChange={(v) => setPrivacy("gender", v)}
                    />
                  </div>
                  <Select value={gender} onValueChange={setGender}>
                    <SelectTrigger className="bg-background/50 border-white/10">
                      <SelectValue placeholder="Select gender" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-white/10">
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="non_binary">Non-binary</SelectItem>
                      <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="languagesSpoken">Languages (comma-separated)</Label>
                    <PrivacySelector
                      value={getPrivacy("languages")}
                      onChange={(v) => setPrivacy("languages", v)}
                    />
                  </div>
                  <Input
                    id="languagesSpoken"
                    value={languagesSpoken}
                    onChange={(e) => setLanguagesSpoken(e.target.value)}
                    placeholder="e.g. English, Spanish, French"
                    className="bg-background/50 border-white/10"
                  />
                </div>
              </div>
            </div>

            {/* Appearance */}
            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-serif text-white mb-6">Appearance</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="hairColor">Hair Color</Label>
                      <PrivacySelector
                        value={getPrivacy("hairColor")}
                        onChange={(v) => setPrivacy("hairColor", v)}
                      />
                    </div>
                    <Input
                      id="hairColor"
                      value={hairColor}
                      onChange={(e) => setHairColor(e.target.value)}
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="eyeColor">Eye Color</Label>
                      <PrivacySelector
                        value={getPrivacy("eyeColor")}
                        onChange={(v) => setPrivacy("eyeColor", v)}
                      />
                    </div>
                    <Input
                      id="eyeColor"
                      value={eyeColor}
                      onChange={(e) => setEyeColor(e.target.value)}
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Body Type</Label>
                      <PrivacySelector
                        value={getPrivacy("bodyType")}
                        onChange={(v) => setPrivacy("bodyType", v)}
                      />
                    </div>
                    <Select value={bodyType} onValueChange={setBodyType}>
                      <SelectTrigger className="bg-background/50 border-white/10">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-white/10">
                        <SelectItem value="slim">Slim</SelectItem>
                        <SelectItem value="athletic">Athletic</SelectItem>
                        <SelectItem value="average">Average</SelectItem>
                        <SelectItem value="muscular">Muscular</SelectItem>
                        <SelectItem value="curvy">Curvy</SelectItem>
                        <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="height">Height</Label>
                      <PrivacySelector
                        value={getPrivacy("height")}
                        onChange={(v) => setPrivacy("height", v)}
                      />
                    </div>
                    <Input
                      id="height"
                      value={height}
                      onChange={(e) => setHeight(e.target.value)}
                      placeholder="e.g. 5'9&quot;"
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Hookah Preferences */}
            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-serif text-white mb-6">
                Hookah Preferences
              </h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="favoriteHookahFlavor">Favorite Flavor</Label>
                      <PrivacySelector
                        value={getPrivacy("favoriteHookahFlavor")}
                        onChange={(v) => setPrivacy("favoriteHookahFlavor", v)}
                      />
                    </div>
                    <Input
                      id="favoriteHookahFlavor"
                      value={favoriteHookahFlavor}
                      onChange={(e) => setFavoriteHookahFlavor(e.target.value)}
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="favoriteHookahLounge">Favorite Lounge</Label>
                      <PrivacySelector
                        value={getPrivacy("favoriteHookahLounge")}
                        onChange={(v) => setPrivacy("favoriteHookahLounge", v)}
                      />
                    </div>
                    <Input
                      id="favoriteHookahLounge"
                      value={favoriteHookahLounge}
                      onChange={(e) => setFavoriteHookahLounge(e.target.value)}
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="favoriteHookahBrand">Favorite Brand</Label>
                      <PrivacySelector
                        value={getPrivacy("favoriteHookahBrand")}
                        onChange={(v) => setPrivacy("favoriteHookahBrand", v)}
                      />
                    </div>
                    <Input
                      id="favoriteHookahBrand"
                      value={favoriteHookahBrand}
                      onChange={(e) => setFavoriteHookahBrand(e.target.value)}
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Experience Level</Label>
                      <PrivacySelector
                        value={getPrivacy("hookahExperienceLevel")}
                        onChange={(v) => setPrivacy("hookahExperienceLevel", v)}
                      />
                    </div>
                    <Select value={hookahExperienceLevel} onValueChange={setHookahExperienceLevel}>
                      <SelectTrigger className="bg-background/50 border-white/10">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-white/10">
                        <SelectItem value="beginner">Beginner</SelectItem>
                        <SelectItem value="intermediate">Intermediate</SelectItem>
                        <SelectItem value="advanced">Advanced</SelectItem>
                        <SelectItem value="expert">Expert</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="preferredHookahStyle">Preferred Style</Label>
                    <PrivacySelector
                      value={getPrivacy("preferredHookahStyle")}
                      onChange={(v) => setPrivacy("preferredHookahStyle", v)}
                    />
                  </div>
                  <Input
                    id="preferredHookahStyle"
                    value={preferredHookahStyle}
                    onChange={(e) => setPreferredHookahStyle(e.target.value)}
                    placeholder="e.g. Egyptian, traditional, modern..."
                    className="bg-background/50 border-white/10"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="favoriteSmokeSessionVibe">Session Vibe</Label>
                    <PrivacySelector
                      value={getPrivacy("favoriteSmokeSessionVibe")}
                      onChange={(v) => setPrivacy("favoriteSmokeSessionVibe", v)}
                    />
                  </div>
                  <Input
                    id="favoriteSmokeSessionVibe"
                    value={favoriteSmokeSessionVibe}
                    onChange={(e) => setFavoriteSmokeSessionVibe(e.target.value)}
                    placeholder="e.g. chill, social, late-night..."
                    className="bg-background/50 border-white/10"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="favoriteHookahAccessories">Accessories</Label>
                    <PrivacySelector
                      value={getPrivacy("favoriteHookahAccessories")}
                      onChange={(v) => setPrivacy("favoriteHookahAccessories", v)}
                    />
                  </div>
                  <Input
                    id="favoriteHookahAccessories"
                    value={favoriteHookahAccessories}
                    onChange={(e) => setFavoriteHookahAccessories(e.target.value)}
                    placeholder="e.g. glass tips, ice chambers..."
                    className="bg-background/50 border-white/10"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="favoriteLoungeCity">
                      Favorite Lounge City
                    </Label>
                    <PrivacySelector
                      value={getPrivacy("favoriteLoungeCity")}
                      onChange={(v) => setPrivacy("favoriteLoungeCity", v)}
                    />
                  </div>
                  <Input
                    id="favoriteLoungeCity"
                    value={favoriteLoungeCity}
                    onChange={(e) => setFavoriteLoungeCity(e.target.value)}
                    className="bg-background/50 border-white/10"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Open to Lounge Meetups</Label>
                    <PrivacySelector
                      value={getPrivacy("openToLoungeMeetups")}
                      onChange={(v) => setPrivacy("openToLoungeMeetups", v)}
                    />
                  </div>
                  <Select value={openToLoungeMeetups} onValueChange={setOpenToLoungeMeetups}>
                    <SelectTrigger className="bg-background/50 border-white/10">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-white/10">
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="sometimes">Sometimes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Interests */}
            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-serif text-white mb-6">Interests</h2>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">
                  Add tags to help others find common interests.
                </p>
                <PrivacySelector
                  value={getPrivacy("interests")}
                  onChange={(v) => setPrivacy("interests", v)}
                />
              </div>
              <InterestTags
                tags={interests}
                onChange={setInterests}
                suggestions={SUGGESTED_INTERESTS}
              />
            </div>

            {/* Social Links */}
            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-serif text-white mb-6">Social Links</h2>
              <div className="space-y-3">
                {["website", "instagram", "tiktok", "youtube", "x", "facebook", "snapchat"].map(
                  (platform) => (
                    <div key={platform}>
                      <Label htmlFor={platform} className="capitalize">
                        {platform === "x" ? "X (Twitter)" : platform}
                      </Label>
                      <Input
                        id={platform}
                        type="url"
                        value={socialLinks[platform] || ""}
                        onChange={(e) => setSocialLink(platform, e.target.value)}
                        placeholder="https://..."
                        className="bg-background/50 border-white/10 mt-1"
                      />
                    </div>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {myProfile?.profileCompletion && (
              <ProfileCompletionMeter
                percent={myProfile.profileCompletion.percent}
                missing={myProfile.profileCompletion.missing}
              />
            )}

            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-xl p-6">
              <h3 className="text-lg font-serif text-white mb-3">Privacy Info</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Use the privacy selectors next to each field to control who can see
                that information.
              </p>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  </div>
                  <span className="text-white/70">
                    <strong>Public:</strong> Everyone can see
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  </div>
                  <span className="text-white/70">
                    <strong>Buddys:</strong> Only your Buddys
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  </div>
                  <span className="text-white/70">
                    <strong>Followers:</strong> Buddys + followers
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  </div>
                  <span className="text-white/70">
                    <strong>Only me:</strong> Private
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
