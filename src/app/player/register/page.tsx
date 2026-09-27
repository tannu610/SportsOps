"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  User,
  Phone,
  Mail,
  CheckCircle,
  Copy,
  Check,
  ArrowRight,
  ChevronLeft,
  AlertCircle
} from "lucide-react";
import { isCategoryApplicableToGender } from "@/utils/eventConfig";

type SportConfigOption = {
  name: string;
  categories: string[];
};

export default function MatchDayRegistrationPage() {
  const router = useRouter();

  // Form input states
  const [empId, setEmpId] = useState("");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"Male" | "Female">("Male");
  const [sport, setSport] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [mobileNo, setMobileNo] = useState("");
  const [email, setEmail] = useState("");

  // Dynamic Event Configuration
  const [sportsOptions, setSportsOptions] = useState<SportConfigOption[]>([]);
  const [isConfigLoading, setIsConfigLoading] = useState(true);

  // Submission & Flow states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [alreadyRegisteredInfo, setAlreadyRegisteredInfo] = useState<{
    message: string;
    employee_id?: string;
    player_code?: string;
    name?: string;
  } | null>(null);
  const [registeredPlayer, setRegisteredPlayer] = useState<{
    id: string;
    name: string;
    player_code: string;
    gender: string;
    sport: string;
    category: string;
    status: string;
  } | null>(null);
  const [checkInToken, setCheckInToken] = useState<string | null>(null);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);

  // Load configured sports and categories from the active event
  useEffect(() => {
    async function loadEventConfig() {
      try {
        setIsConfigLoading(true);
        const res = await fetch("/api/admin/event/config");
        if (res.ok) {
          const data = await res.json();
          if (data.configuration?.sports) {
            const sports = data.configuration.sports;
            const parsedOptions: SportConfigOption[] = [];

            Object.entries(sports).forEach(([sName, sCfg]: [string, any]) => {
              if (sCfg?.enabled) {
                parsedOptions.push({
                  name: sName,
                  categories: Array.isArray(sCfg.categories) && sCfg.categories.length > 0 ? sCfg.categories : []
                });
              }
            });

            setSportsOptions(parsedOptions);
            if (parsedOptions.length > 0) {
              setSport(parsedOptions[0].name);
            }
          } else {
            setSportsOptions([]);
          }
        } else {
          setSportsOptions([]);
        }
      } catch (err) {
        console.error("Error loading event config:", err);
        setSportsOptions([]);
      } finally {
        setIsConfigLoading(false);
      }
    }
    loadEventConfig();
  }, []);

  // Filter categories by selected sport and player gender
  const activeSportConfig = sportsOptions.find((s) => s.name === sport);
  const applicableCategories = (activeSportConfig?.categories || []).filter((c) =>
    isCategoryApplicableToGender(c, gender)
  );

  // When gender changes: re-filter and uncheck any categories not applicable to new gender
  const handleGenderChange = (newGender: "Male" | "Female") => {
    setGender(newGender);
    setSelectedCategories((prev) =>
      prev.filter((cat) => isCategoryApplicableToGender(cat, newGender))
    );
  };

  // When sport changes: reset category selection to prevent invalid pairings
  const handleSportChange = (newSport: string) => {
    setSport(newSport);
    setSelectedCategories([]);
  };

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) => {
      if (prev.includes(cat)) {
        return prev.filter((c) => c !== cat);
      } else {
        return [...prev, cat];
      }
    });
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setAlreadyRegisteredInfo(null);

    // Client-side validations
    if (!empId.trim()) {
      setFormError("Employee ID is required.");
      return;
    }
    if (!name.trim()) {
      setFormError("Full Name is required.");
      return;
    }
    if (!gender || (gender !== "Male" && gender !== "Female")) {
      setFormError("Please select your gender.");
      return;
    }
    if (!sport) {
      setFormError("Please select a sport.");
      return;
    }
    if (selectedCategories.length === 0) {
      setFormError("Please select at least one category for " + sport + ".");
      return;
    }
    if (!mobileNo.trim()) {
      setFormError("Mobile / Contact Number is required.");
      return;
    }
    const digitsOnly = mobileNo.replace(/\D/g, "");
    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
      setFormError("Please enter a valid mobile number (7-15 digits).");
      return;
    }
    if (email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        setFormError("Please enter a valid email address.");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/player/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: empId.trim(),
          name: name.trim(),
          gender,
          sport,
          categories: selectedCategories,
          contact_info: mobileNo.trim(),
          email: email.trim() || null
        })
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          // Already registered duplicate handling
          setAlreadyRegisteredInfo({
            message: data.message || "Please continue to Check In using your Employee ID and Player Code.",
            employee_id: data.player?.employee_id || empId.trim().toUpperCase(),
            player_code: data.player?.player_code,
            name: data.player?.name
          });
          return;
        }
        setFormError(data.error || "Registration failed. Please check your information.");
        return;
      }

      // Success
      setRegisteredPlayer({
        id: data.player.id,
        name: data.player.name,
        player_code: data.player.player_code,
        gender: data.player.gender,
        sport: data.player.sport,
        category: data.player.category,
        status: data.player.status || "REGISTERED"
      });
      setCheckInToken(data.check_in_token || null);
    } catch (err: any) {
      setFormError(err.message || "Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Automatic Check-In Handler
  const handleAutoCheckIn = async () => {
    if (!registeredPlayer || isCheckingIn) return;
    setIsCheckingIn(true);
    setCheckInError("");

    try {
      const res = await fetch("/api/player/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: registeredPlayer.id,
          token: checkInToken
        })
      });

      const data = await res.json();

      if (!res.ok) {
        setCheckInError(
          data.error || "Registration completed, but we couldn't complete your check-in. Please try again."
        );
        setIsCheckingIn(false);
        return;
      }

      const pid = data.player?.id || registeredPlayer.id;

      // Save persistent session for dashboard
      if (typeof window !== "undefined") {
        localStorage.setItem("sports_player_id", pid);
      }

      // Redirect directly to Player Dashboard
      router.push(`/player/dashboard?id=${pid}`);
    } catch (err: any) {
      setCheckInError("Registration completed, but we couldn't complete your check-in. Please try again.");
      setIsCheckingIn(false);
    }
  };

  // SUCCESS VIEW
  if (registeredPlayer) {
    return (
      <div className="p-6 min-h-screen flex flex-col justify-center max-w-md mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-950/50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-2 border border-green-200 dark:border-green-800">
            <CheckCircle className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Registration Successful ✓</h1>
          <p className="text-sm text-gray-500">Your match-day registration is complete!</p>
        </div>

        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-zinc-800 space-y-5">
          <div className="border-b border-gray-100 dark:border-zinc-800 pb-4">
            <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Player Name</span>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{registeredPlayer.name}</h2>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 p-4 rounded-xl flex items-center justify-between">
            <div>
              <span className="text-xs uppercase tracking-wider text-blue-600 dark:text-blue-400 font-bold block">
                Player Code
              </span>
              <span className="text-2xl font-black font-mono tracking-widest text-blue-900 dark:text-blue-200">
                {registeredPlayer.player_code}
              </span>
            </div>
            <button
              onClick={() => handleCopyCode(registeredPlayer.player_code)}
              className="p-2.5 bg-white dark:bg-zinc-900 border border-blue-300 dark:border-blue-700 rounded-lg text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
              title="Copy Player Code"
            >
              {copiedCode ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-50 dark:bg-zinc-950 p-3 rounded-xl border border-gray-100 dark:border-zinc-800">
              <span className="text-xs text-gray-400 font-medium block">Gender</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">{registeredPlayer.gender}</span>
            </div>
            <div className="bg-gray-50 dark:bg-zinc-950 p-3 rounded-xl border border-gray-100 dark:border-zinc-800">
              <span className="text-xs text-gray-400 font-medium block">Status</span>
              <span className="font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wide">
                {registeredPlayer.status}
              </span>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-zinc-950 p-3 rounded-xl border border-gray-100 dark:border-zinc-800">
            <span className="text-xs text-gray-400 font-medium block">Sport & Category</span>
            <p className="font-semibold text-gray-800 dark:text-gray-200 mt-0.5">
              {registeredPlayer.sport}
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              {registeredPlayer.category}
            </p>
          </div>

          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 rounded-xl text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
            Your registration is complete. Continue below to check in for today&apos;s event.
          </div>

          {checkInError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-400 space-y-2">
              <p className="font-medium">{checkInError}</p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleAutoCheckIn}
                  disabled={isCheckingIn}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-xs transition-colors disabled:opacity-50"
                >
                  Try Check-In Again
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/player/check-in")}
                  className="px-3 py-1.5 bg-gray-200 dark:bg-zinc-800 hover:bg-gray-300 text-gray-800 dark:text-gray-200 rounded-lg font-medium text-xs transition-colors"
                >
                  Go to Check-In
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleAutoCheckIn}
            disabled={isCheckingIn}
            className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-bold flex justify-center items-center gap-2 hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50"
          >
            {isCheckingIn ? "Checking In..." : "Continue to Check In"}
            {!isCheckingIn && <ArrowRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    );
  }

  // ALREADY REGISTERED VIEW
  if (alreadyRegisteredInfo) {
    return (
      <div className="p-6 min-h-screen flex flex-col justify-center max-w-md mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-amber-100 dark:bg-amber-950/50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-2 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Already registered.</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">{alreadyRegisteredInfo.message}</p>
        </div>

        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-zinc-800 space-y-5">
          {alreadyRegisteredInfo.employee_id && (
            <div className="p-3 bg-gray-50 dark:bg-zinc-950 rounded-xl border border-gray-100 dark:border-zinc-800">
              <span className="text-xs text-gray-400 font-medium block">Employee ID</span>
              <span className="font-mono font-bold text-gray-800 dark:text-gray-200">
                {alreadyRegisteredInfo.employee_id}
              </span>
            </div>
          )}

          {alreadyRegisteredInfo.player_code && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-800">
              <span className="text-xs text-blue-600 dark:text-blue-400 font-medium block">Player Code</span>
              <span className="font-mono font-black text-xl text-blue-900 dark:text-blue-200">
                {alreadyRegisteredInfo.player_code}
              </span>
            </div>
          )}

          <div className="space-y-3 pt-2">
            <button
              onClick={() => router.push("/player/check-in")}
              className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-bold flex justify-center items-center gap-2 hover:bg-blue-700 transition-colors shadow-md"
            >
              Continue to Check In
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => setAlreadyRegisteredInfo(null)}
              className="w-full py-2.5 bg-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm font-medium"
            >
              Back to Registration Form
            </button>
          </div>
        </div>
      </div>
    );
  }

  // MAIN REGISTRATION FORM
  return (
    <div className="p-6 min-h-screen flex flex-col justify-center max-w-md mx-auto space-y-6 pb-16">
      {/* Top back navigation */}
      <div>
        <Link
          href="/player/check-in"
          className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Check-In
        </Link>
      </div>

      <div className="text-center space-y-1">
        <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white uppercase">
          MATCH-DAY REGISTRATION
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Not registered yet? Register for today&apos;s event.
        </p>
      </div>

      <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-zinc-800 space-y-6">
        {!isConfigLoading && sportsOptions.length === 0 ? (
          <div className="p-5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-center space-y-2">
            <AlertCircle className="w-8 h-8 text-amber-600 dark:text-amber-400 mx-auto" />
            <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
              No sports are currently configured for this event.
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Registration cannot be completed at this time. Please contact the tournament committee.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* 1. Employee ID */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider ml-1">
                Employee ID *
              </label>
              <div className="relative">
                <User className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value.toUpperCase())}
                  placeholder="e.g. 123456 or EMP101"
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  required
                />
              </div>
            </div>

            {/* 2. Full Name */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider ml-1">
                Full Name *
              </label>
              <div className="relative">
                <User className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Tannu Jha"
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            {/* 3. Gender (Male / Female only) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider ml-1">
                Gender *
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["Male", "Female"] as const).map((g) => (
                  <button
                    type="button"
                    key={g}
                    onClick={() => handleGenderChange(g)}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-colors ${
                      gender === g
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                        : "bg-gray-50 dark:bg-zinc-950 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Sport (From Event Configuration) */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider ml-1">
                Sport *
              </label>
              <select
                value={sport}
                onChange={(e) => handleSportChange(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                {sportsOptions.map((opt) => (
                  <option key={opt.name} value={opt.name}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 5. Category / Categories (Filtered by Sport & Gender) */}
            <div className="space-y-2">
              <div className="flex justify-between items-center ml-1">
                <label className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  Category / Categories *
                </label>
                <span className="text-[11px] text-gray-400 font-medium">Select all that apply</span>
              </div>

              {applicableCategories.length === 0 ? (
                <div className="p-3 bg-gray-50 dark:bg-zinc-950 rounded-xl border border-gray-200 dark:border-zinc-800 text-xs text-gray-500 text-center">
                  No categories configured for {gender} in {sport || "this sport"}.
                </div>
              ) : (
                <div className="space-y-2 bg-gray-50 dark:bg-zinc-950 p-3 rounded-xl border border-gray-200 dark:border-zinc-800">
                  {applicableCategories.map((cat) => {
                    const isChecked = selectedCategories.includes(cat);
                    return (
                      <label
                        key={cat}
                        onClick={() => toggleCategory(cat)}
                        className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                          isChecked
                            ? "bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 font-semibold"
                            : "hover:bg-gray-100 dark:hover:bg-zinc-900 text-gray-700 dark:text-gray-300 font-medium"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // Controlled by label wrapper
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-xs">{cat}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 6. Mobile / Contact Number */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider ml-1">
                Mobile / Contact Number *
              </label>
              <div className="relative">
                <Phone className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="tel"
                  value={mobileNo}
                  onChange={(e) => setMobileNo(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            {/* 7. Email ID (Optional) */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                Email ID <span className="text-gray-400 font-normal lowercase">(optional)</span>
              </label>
              <div className="relative">
                <Mail className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {formError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-xs font-medium text-center">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={
                isSubmitting ||
                isConfigLoading ||
                sportsOptions.length === 0 ||
                !empId.trim() ||
                !name.trim() ||
                !mobileNo.trim() ||
                !sport ||
                selectedCategories.length === 0
              }
              className="w-full py-3.5 mt-2 bg-blue-600 text-white rounded-xl font-bold flex justify-center items-center gap-2 hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-md"
            >
              {isSubmitting ? "Registering Player..." : "Complete Registration"}
              {!isSubmitting && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
