'use client'

import React, { useState, useEffect } from 'react'
import { analytics } from '@/lib/analytics'
import { funnelAnalysis } from '@/lib/funnel-analysis'
import { performanceTracking } from '@/lib/performance-tracking'
import { consentManager } from '@/lib/consent-manager'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts'

interface AnalyticsData {
  events: any[]
  funnels: Map<string, any>
  performance: any
  consent: any
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData>({
    events: [],
    funnels: new Map(),
    performance: {},
    consent: {}
  })
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = () => {
    setLoading(true)
    
    try {
      const events = analytics.getEvents()
      const funnels = funnelAnalysis.getAllFunnelAnalytics()
      const performance = performanceTracking.getMetrics()
      const consent = consentManager.getPreferences()

      setData({
        events,
        funnels,
        performance,
        consent
      })
    } catch (error) {
      console.error('Failed to load analytics data:', error)
    } finally {
      setLoading(false)
    }
  }

  const exportData = () => {
    const exportData = {
      timestamp: Date.now(),
      events: data.events,
      funnels: Object.fromEntries(data.funnels),
      performance: data.performance,
      consent: data.consent
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analytics-export-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const clearData = () => {
    if (confirm('Are you sure you want to clear all analytics data? This action cannot be undone.')) {
      analytics.reset()
      funnelAnalysis.clearFunnelData()
      performanceTracking.reset()
      loadData()
    }
  }

  // Event analytics
  const getEventStats = (): Array<{name: string, count: number}> => {
    const eventCounts = data.events.reduce((acc, event) => {
      acc[event.event] = (acc[event.event] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return Object.entries(eventCounts)
      .map(([name, count]) => ({ name, count: Number(count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }

  // Funnel analytics
  const getFunnelStats = () => {
    return Array.from(data.funnels.entries()).map(([name, analytics]) => ({
      name,
      conversionRate: analytics.conversionRate * 100,
      totalUsers: analytics.totalUsers,
      averageTime: analytics.averageTime / 1000 / 60 // Convert to minutes
    }))
  }

  // Performance analytics
  const getPerformanceStats = () => {
    const metrics = data.performance
    return [
      { name: 'FCP', value: metrics.fcp, unit: 'ms', threshold: 1800 },
      { name: 'LCP', value: metrics.lcp, unit: 'ms', threshold: 2500 },
      { name: 'FID', value: metrics.fid, unit: 'ms', threshold: 100 },
      { name: 'CLS', value: metrics.cls, unit: 'score', threshold: 0.1 },
      { name: 'TTFB', value: metrics.ttfb, unit: 'ms', threshold: 800 }
    ].filter(metric => metric.value !== undefined)
  }

  // Consent analytics
  const getConsentStats = () => {
    return [
      { category: 'Analytics', granted: data.consent.analytics },
      { category: 'Performance', granted: data.consent.performance },
      { category: 'Functional', granted: data.consent.functional },
      { category: 'Marketing', granted: data.consent.marketing }
    ]
  }

  const getProgressColorClass = (value: number, threshold: number): string => {
    if (value <= threshold) {
      return 'bg-green-100'
    } else if (value <= threshold * 1.5) {
      return 'bg-yellow-100'
    } else {
      return 'bg-red-100'
    }
  }

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8']

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading analytics data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Analytics Dashboard</h1>
            <p className="text-gray-600 mt-2">Monitor user behavior, performance, and consent metrics</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={loadData} variant="outline">
              Refresh Data
            </Button>
            <Button onClick={exportData} variant="outline">
              Export
            </Button>
            <Button onClick={clearData} variant="destructive">
              Clear Data
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="funnels">Funnels</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="consent">Consent</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Total Events</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.events.length}</div>
                  <p className="text-xs text-muted-foreground">Tracked user actions</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Active Funnels</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.funnels.size}</div>
                  <p className="text-xs text-muted-foreground">User flow tracking</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Performance Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {performanceTracking.getPerformanceScore().overall.toFixed(0)}
                  </div>
                  <p className="text-xs text-muted-foreground">Overall performance</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Consent Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {getConsentStats().filter(s => s.granted).length}/4
                  </div>
                  <p className="text-xs text-muted-foreground">Categories enabled</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Top Events</CardTitle>
                  <CardDescription>Most frequent user actions</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={getEventStats()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#8884d8" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Consent Status</CardTitle>
                  <CardDescription>Privacy consent breakdown</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={getConsentStats()}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ category, granted }) => `${category}: ${granted ? 'Yes' : 'No'}`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="granted"
                      >
                        {getConsentStats().map((entry, index) => (
                          <Cell key={`cell-${entry.category}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="events" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Event Tracking</CardTitle>
                <CardDescription>All tracked user events and actions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {getEventStats().map((event) => (
                    <div key={event.name} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <h4 className="font-medium">{event.name}</h4>
                        <p className="text-sm text-gray-600">{event.count} occurrences</p>
                      </div>
                      <Badge variant="secondary">{event.count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="funnels" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {getFunnelStats().map((funnel) => (
                <Card key={funnel.name}>
                  <CardHeader>
                    <CardTitle>{funnel.name}</CardTitle>
                    <CardDescription>User conversion funnel</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between">
                        <span className="text-sm font-medium">Conversion Rate</span>
                        <span className="text-sm">{funnel.conversionRate.toFixed(1)}%</span>
                      </div>
                      <Progress value={funnel.conversionRate} className="h-2" />
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>{funnel.totalUsers} users</span>
                        <span>{funnel.averageTime.toFixed(1)} min avg</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Performance Metrics</CardTitle>
                <CardDescription>Core Web Vitals and performance indicators</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {getPerformanceStats().map((metric) => (
                    <div key={metric.name} className="space-y-2">
                      <div className="flex justify-between">
                        <span className="font-medium">{metric.name}</span>
                        <span className="text-sm">
                          {metric.value?.toFixed(0)} {metric.unit}
                        </span>
                      </div>
                      <Progress 
                        value={Math.min((metric.value! / metric.threshold) * 100, 100)} 
                        className={`h-2 ${getProgressColorClass(metric.value, metric.threshold)}`}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="consent" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Privacy Consent</CardTitle>
                <CardDescription>User consent preferences and privacy settings</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {getConsentStats().map((stat, index) => (
                    <div key={stat.category} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <h4 className="font-medium">{stat.category}</h4>
                        <p className="text-sm text-gray-600">
                          {stat.granted ? 'Consent granted' : 'Consent denied'}
                        </p>
                      </div>
                      <Badge variant={stat.granted ? 'default' : 'secondary'}>
                        {stat.granted ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
