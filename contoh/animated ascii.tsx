"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { ASCIIBackground } from "@/components/ascii-background"
import "../../../styling/glassmorphism-buttons.css"

export default function LoginPage() {
  const [email, setEmail] = useState("john.doe@example.com")
  const [password, setPassword] = useState("abc123#")
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    // Simulate login process
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Redirect to profile page
    router.push("/profile-alif")
  }

  const handleSocialLogin = (provider: string) => {
    console.log(`Login with ${provider}`)
    // Simulate social login
    router.push("/profile-alif")
  }

  return (
    <div className="min-h-screen relative flex flex-col">
      {/* ASCII Background */}
      <ASCIIBackground />

      {/* Content */}
      <div className="relative z-10">
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center p-4 pt-20 min-h-screen">
          <div className="w-full max-w-md">
            {/* Logo */}
            <div className="text-center mb-8">
              <div className="text-white text-4xl font-bold mb-2">Notaku</div>
              <h1 className="text-white text-2xl font-semibold">Log in</h1>
            </div>

            <Card className="bg-gray-800/90 border-gray-700 backdrop-blur-sm">
              <CardContent className="p-6 space-y-4">
                {/* Social Login Buttons */}
                <Button
                  onClick={() => handleSocialLogin("Google")}
                  variant="outline"
                  className="w-full bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
                >
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Log in with Google
                </Button>

                <Button
                  onClick={() => handleSocialLogin("GitHub")}
                  variant="outline"
                  className="w-full bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
                >
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  Log in with GitHub
                </Button>

                {/* AI Model Login Section */}
                <div className="space-y-4">
                  <div className="text-center">
                    <h3 className="text-white text-lg font-semibold mb-4">Log In with Agent</h3>
                  </div>

                  <div className="grid grid-cols-4 gap-3">
                    {/* Row 1 */}
                    <div className="ai-button-wrap">
                      <div className="ai-button-shadow"></div>
                      <button onClick={() => handleSocialLogin("ChatGPT")} className="ai-button">
                        <div className="ai-button-content">
                          <div className="w-6 h-6 flex items-center justify-center">
                            <img src="/images/logos/chatgpt.png" alt="ChatGPT" className="w-5 h-5 object-contain" />
                          </div>
                          <span>ChatGPT</span>
                        </div>
                      </button>
                    </div>

                    <div className="ai-button-wrap">
                      <div className="ai-button-shadow"></div>
                      <button onClick={() => handleSocialLogin("Claude")} className="ai-button">
                        <div className="ai-button-content">
                          <div className="w-6 h-6 flex items-center justify-center">
                            <img src="/images/logos/anthropic.png" alt="Claude" className="w-5 h-5 object-contain" />
                          </div>
                          <span>Claude</span>
                        </div>
                      </button>
                    </div>

                    <div className="ai-button-wrap">
                      <div className="ai-button-shadow"></div>
                      <button onClick={() => handleSocialLogin("Gemini")} className="ai-button">
                        <div className="ai-button-content">
                          <div className="w-6 h-6 flex items-center justify-center">
                            <img src="/images/logos/gemini.png" alt="Gemini" className="w-5 h-5 object-contain" />
                          </div>
                          <span>Gemini</span>
                        </div>
                      </button>
                    </div>

                    <div className="ai-button-wrap">
                      <div className="ai-button-shadow"></div>
                      <button onClick={() => handleSocialLogin("Perplexity")} className="ai-button">
                        <div className="ai-button-content">
                          <div className="w-6 h-6 flex items-center justify-center">
                            <img
                              src="/images/logos/perplexity.png"
                              alt="Perplexity"
                              className="w-5 h-5 object-contain"
                            />
                          </div>
                          <span>Perplexity</span>
                        </div>
                      </button>
                    </div>

                    {/* Row 2 */}
                    <div className="ai-button-wrap">
                      <div className="ai-button-shadow"></div>
                      <button onClick={() => handleSocialLogin("Deepseek")} className="ai-button">
                        <div className="ai-button-content">
                          <div className="w-6 h-6 flex items-center justify-center">
                            <img src="/images/logos/deepseek.png" alt="Deepseek" className="w-5 h-5 object-contain" />
                          </div>
                          <span>Deepseek</span>
                        </div>
                      </button>
                    </div>

                    <div className="ai-button-wrap">
                      <div className="ai-button-shadow"></div>
                      <button onClick={() => handleSocialLogin("Grok")} className="ai-button">
                        <div className="ai-button-content">
                          <div className="w-6 h-6 flex items-center justify-center">
                            <svg className="w-5 h-5" fill="white" viewBox="0 0 24 24">
                              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                            </svg>
                          </div>
                          <span>Grok</span>
                        </div>
                      </button>
                    </div>

                    <div className="ai-button-wrap">
                      <div className="ai-button-shadow"></div>
                      <button onClick={() => handleSocialLogin("Mistral")} className="ai-button">
                        <div className="ai-button-content">
                          <div className="w-6 h-6 flex items-center justify-center">
                            <img src="/images/logos/mistral.png" alt="Mistral" className="w-5 h-5 object-contain" />
                          </div>
                          <span>Mistral</span>
                        </div>
                      </button>
                    </div>

                    <div className="ai-button-wrap">
                      <div className="ai-button-shadow"></div>
                      <button onClick={() => handleSocialLogin("Co-Pilot")} className="ai-button">
                        <div className="ai-button-content">
                          <div className="w-6 h-6 flex items-center justify-center">
                            <img src="/images/logos/copilot.webp" alt="Co-Pilot" className="w-5 h-5 object-contain" />
                          </div>
                          <span>Co-Pilot</span>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={() => handleSocialLogin("SSO")}
                  variant="outline"
                  className="w-full bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
                >
                  Sign in with SSO for Enterprise
                </Button>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-gray-600" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-gray-800 px-2 text-gray-400">or</span>
                  </div>
                </div>

                {/* Email/Password Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-white">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email address"
                      className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-white">
                      Password
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
                      required
                    />
                  </div>

                  <div className="text-left">
                    <Link href="/auth/forgot-password" className="text-sm text-teal-400 hover:text-teal-300">
                      Forgot password? Send reset code.
                    </Link>
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-teal-500 hover:bg-teal-600 text-white font-medium"
                  >
                    {isLoading ? "Logging in..." : "Log in"}
                  </Button>
                </form>

                <div className="text-center">
                  <span className="text-gray-400">Don't have an account? </span>
                  <Link href="/auth/signup" className="text-teal-400 hover:text-teal-300">
                    Sign up.
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
