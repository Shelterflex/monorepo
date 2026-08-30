"use client";

import React, { useState } from "react"
import Link from 'next/link'
import { ArrowLeft, Send, Mail, Phone, MapPin, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { submitSupportMessage } from '@/lib/api/support'
import { useTranslations } from "next-intl"

export default function ContactPage() {
  const t = useTranslations("contact")

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
  })
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    // Clear field error when user starts typing
    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }
  }

  const handleSubmit: React.ComponentProps<'form'>['onSubmit'] = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setFieldErrors({})

    try {
      await submitSupportMessage(formData)
      setSubmitted(true)
      setFormData({ name: '', email: '', phone: '', subject: '', message: '' })
      setTimeout(() => setSubmitted(false), 5000)
    } catch (err) {
      if (err instanceof Error) {
        // Check if it's an ApiError with field validation errors
        const apiError = err as any
        if (apiError.details) {
          setFieldErrors(apiError.details as Record<string, string>)
          setError(t("form.failedDescription"))
        } else {
          // If it's a TypeError or network error, show generic error, otherwise show err.message
          const isNetworkError = err.name === 'TypeError' || err.message?.includes('fetch') || err.message?.includes('network')
          setError(isNetworkError ? t("form.failedGeneric") : (err.message || t("form.failedGeneric")))
        }
      } else {
        setError(t("form.failedGeneric"))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b-3 border-foreground bg-card pt-24 pb-8 md:pb-12">
        <div className="container mx-auto px-4">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold mb-6 border-3 border-foreground p-2 hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
            {t("backHome")}
          </Link>
          <h1 className="font-mono text-2xl font-black md:text-4xl">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground md:text-base">{t("description")}</p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-8 md:py-12 lg:py-16">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Contact Form */}
            <div>
              <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                <h2 className="mb-4 font-mono text-lg font-bold md:mb-6 md:text-xl">{t("form.title")}</h2>
                
                {submitted && (
                  <div className="mb-6 border-3 border-secondary bg-secondary/10 p-4">
                    <p className="font-bold text-secondary">{t("form.successTitle")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("form.successDescription")}</p>
                  </div>
                )}

                {error && (
                  <div className="mb-6 border-3 border-destructive bg-destructive/10 p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-destructive">{t("form.failedTitle")}</p>
                        <p className="text-sm text-destructive/80 mt-1">{error}</p>
                      </div>
                    </div>
                  </div>
                )}

                <form noValidate onSubmit={handleSubmit} className="space-y-4 md:space-y-6">
                  <div>
                    <label htmlFor="contact-name" className="mb-2 block text-sm font-bold">{t("form.nameLabel")}</label>
                    <Input
                      id="contact-name"
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      placeholder={t("form.namePlaceholder")}
                      required
                      className={`border-3 py-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${fieldErrors.name ? 'border-destructive' : 'border-foreground'}`}
                    />
                    {fieldErrors.name && (
                      <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="contact-email" className="mb-2 block text-sm font-bold">{t("form.emailLabel")}</label>
                    <Input
                      id="contact-email"
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder={t("form.emailPlaceholder")}
                      required
                      className={`border-3 py-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${fieldErrors.email ? 'border-destructive' : 'border-foreground'}`}
                    />
                    {fieldErrors.email && (
                      <p className="text-xs text-destructive mt-1">{fieldErrors.email}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="contact-phone" className="mb-2 block text-sm font-bold">{t("form.phoneLabel")}</label>
                    <Input
                      id="contact-phone"
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      placeholder={t("form.phonePlaceholder")}
                      className={`border-3 py-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${fieldErrors.phone ? 'border-destructive' : 'border-foreground'}`}
                    />
                    {fieldErrors.phone && (
                      <p className="text-xs text-destructive mt-1">{fieldErrors.phone}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="contact-subject" className="mb-2 block text-sm font-bold">{t("form.subjectLabel")}</label>
                    <Input
                      id="contact-subject"
                      type="text"
                      name="subject"
                      value={formData.subject}
                      onChange={handleChange}
                      placeholder={t("form.subjectPlaceholder")}
                      required
                      className={`border-3 py-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${fieldErrors.subject ? 'border-destructive' : 'border-foreground'}`}
                    />
                    {fieldErrors.subject && (
                      <p className="text-xs text-destructive mt-1">{fieldErrors.subject}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="contact-message" className="mb-2 block text-sm font-bold">{t("form.messageLabel")}</label>
                    <textarea
                      id="contact-message"
                      name="message"
                      value={formData.message}
                      onChange={handleChange}
                      placeholder={t("form.messagePlaceholder")}
                      required
                      rows={5}
                      className={`w-full border-3 p-3 font-mono text-sm shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${fieldErrors.message ? 'border-destructive' : 'border-foreground'}`}
                    />
                    {fieldErrors.message && (
                      <p className="text-xs text-destructive mt-1">{fieldErrors.message}</p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full border-3 border-foreground bg-primary py-4 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                  >
                    {loading ? (
                      <>
                        <div className="mr-2 h-4 w-4 animate-spin border-2 border-foreground border-t-transparent rounded-full" />
                        {t("form.sending")}
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 h-4 w-4" />
                        {t("form.send")}
                      </>
                    )}
                  </Button>
                </form>
              </Card>
            </div>

            {/* Contact Information */}
            <div className="space-y-6">
              <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                <h2 className="mb-4 font-mono text-lg font-bold md:mb-6 md:text-xl">{t("info.title")}</h2>
                
                <div className="space-y-4 md:space-y-6">
                  <div className="flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center border-3 border-foreground bg-primary">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold">{t("info.emailLabel")}</h3>
                      <p className="text-sm text-muted-foreground">support@shelterflex.com</p>
                      <p className="text-sm text-muted-foreground">info@shelterflex.com</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center border-3 border-foreground bg-secondary">
                      <Phone className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold">{t("info.phoneLabel")}</h3>
                      <p className="text-sm text-muted-foreground">+234 (0) 123 456 7890</p>
                      <p className="text-sm text-muted-foreground">{t("info.phoneHours")}</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center border-3 border-foreground bg-accent">
                      <MapPin className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold">{t("info.addressLabel")}</h3>
                      <p className="text-sm text-muted-foreground">{t("info.addressLine1")}</p>
                      <p className="text-sm text-muted-foreground">{t("info.addressLine2")}</p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="border-3 border-foreground bg-muted p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                <h3 className="mb-3 font-mono font-bold">{t("info.responseTimeTitle")}</h3>
                <p className="text-sm text-muted-foreground mb-3">{t("info.responseTimeDesc")}</p>
                <p className="text-xs text-muted-foreground">{t("info.responseTimeAvg")}</p>
              </Card>

              <Card className="border-3 border-foreground bg-primary/10 p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                <h3 className="mb-2 font-mono font-bold text-primary">{t("info.needHelpTitle")}</h3>
                <p className="text-sm text-muted-foreground mb-3">{t("info.needHelpDesc")}</p>
                <Link href="/">
                  <Button className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    {t("info.viewFaqs")}
                  </Button>
                </Link>
              </Card>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
