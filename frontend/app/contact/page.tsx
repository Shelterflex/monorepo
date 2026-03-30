'use client'

import React, { useState } from "react";
import Link from 'next/link'
import { ArrowLeft, Send, Mail, Phone, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { useAppForm } from '@/hooks/useAppForm'
import { FormField } from '@/components/ui/FormField'
import { Form } from '@/components/ui/form'
import { contactSchema, type ContactFormValues } from '@/lib/formSchemas'

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false)

  const form = useAppForm<ContactFormValues>({
    schema: contactSchema,
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      subject: '',
      message: '',
    },
  })

  const {
    handleSubmit,
    register,
    reset,
  } = form

  const onSubmit = async () => {
    setSubmitted(true)
    reset()
    setTimeout(() => setSubmitted(false), 5000)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b-3 border-foreground bg-card pt-24 pb-8 md:pb-12">
        <div className="container mx-auto px-4">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold mb-6 border-3 border-foreground p-2 hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
            Back Home
          </Link>
          <h1 className="font-mono text-2xl font-black md:text-4xl">Get in Touch</h1>
          <p className="mt-2 text-sm text-muted-foreground md:text-base">Have questions? We'd love to hear from you.</p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-8 md:py-12 lg:py-16">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Contact Form */}
            <div>
              <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                <h2 className="mb-4 font-mono text-lg font-bold md:mb-6 md:text-xl">Send us a Message</h2>
                
                {submitted && (
                  <div className="mb-6 border-3 border-secondary bg-secondary/10 p-4">
                    <p className="font-bold text-secondary">✓ Message sent successfully!</p>
                    <p className="text-sm text-muted-foreground mt-1">We'll get back to you as soon as possible.</p>
                  </div>
                )}

                <Form {...form}>
                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 md:space-y-6" noValidate>
                    <FormField name="name" label="Name">
                      <Input
                        id="contact-name"
                        type="text"
                        placeholder="Your name"
                        className="border-3 border-foreground py-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                        {...register("name")}
                      />
                    </FormField>

                    <FormField name="email" label="Email">
                      <Input
                        id="contact-email"
                        type="email"
                        placeholder="your@email.com"
                        className="border-3 border-foreground py-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                        {...register("email")}
                      />
                    </FormField>

                    <FormField name="phone" label="Phone (Optional)">
                      <Input
                        id="contact-phone"
                        type="tel"
                        placeholder="+234 (0) 123 456 7890"
                        className="border-3 border-foreground py-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                        {...register("phone")}
                      />
                    </FormField>

                    <FormField name="subject" label="Subject">
                      <Input
                        id="contact-subject"
                        type="text"
                        placeholder="What is this about?"
                        className="border-3 border-foreground py-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                        {...register("subject")}
                      />
                    </FormField>

                  <FormField name="message" label="Message">
                    <textarea
                      id="contact-message"
                      placeholder="Tell us more..."
                      rows={5}
                      className="w-full border-3 border-foreground p-3 font-mono text-sm shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                      {...register("message")}
                    />
                  </FormField>

                  <Button
                    type="submit"
                    className="w-full border-3 border-foreground bg-primary py-4 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Send Message
                  </Button>
                </form>
              </Form>
              </Card>
            </div>

            {/* Contact Information */}
            <div className="space-y-6">
              <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                <h2 className="mb-4 font-mono text-lg font-bold md:mb-6 md:text-xl">Contact Information</h2>
                
                <div className="space-y-4 md:space-y-6">
                  <div className="flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center border-3 border-foreground bg-primary">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold">Email</h3>
                      <p className="text-sm text-muted-foreground">support@sheltaflex.com</p>
                      <p className="text-sm text-muted-foreground">info@sheltaflex.com</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center border-3 border-foreground bg-secondary">
                      <Phone className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold">Phone</h3>
                      <p className="text-sm text-muted-foreground">+234 (0) 123 456 7890</p>
                      <p className="text-sm text-muted-foreground">Mon - Fri, 9am - 6pm WAT</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center border-3 border-foreground bg-accent">
                      <MapPin className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold">Address</h3>
                      <p className="text-sm text-muted-foreground">123 Tech Street</p>
                      <p className="text-sm text-muted-foreground">Lagos, Nigeria 101001</p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="border-3 border-foreground bg-muted p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                <h3 className="mb-3 font-mono font-bold">Response Time</h3>
                <p className="text-sm text-muted-foreground mb-3">We typically respond within 24 hours during business days. For urgent matters, please call us directly.</p>
                <p className="text-xs text-muted-foreground">Average response time: 2-4 hours</p>
              </Card>

              <Card className="border-3 border-foreground bg-primary/10 p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                <h3 className="mb-2 font-mono font-bold text-primary">Need Help?</h3>
                <p className="text-sm text-muted-foreground mb-3">Check our FAQ or knowledge base for instant answers to common questions.</p>
                <Link href="/">
                  <Button className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    View FAQs
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
