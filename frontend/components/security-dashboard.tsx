'use client'

import React, { useState, useEffect } from 'react'
import { SecurityTests } from '@/lib/security-tests'

interface TestResult {
  passed: boolean
  details: string[]
}

interface SecurityReport {
  overall: boolean
  results: {
    csp: TestResult
    storage: TestResult
    rateLimit: TestResult
    csrf: TestResult
    xss: TestResult
  }
}

export default function SecurityDashboard() {
  const [report, setReport] = useState<SecurityReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runTests = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const testResults = await SecurityTests.runAllTests()
      setReport(testResults)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Run tests on component mount
    runTests()
  }, [])

  const TestSection = ({ title, result }: { title: string; result: TestResult }) => (
    <div className={`border rounded-lg p-4 ${result.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-lg">{title}</h3>
        <span className={`px-2 py-1 rounded text-sm font-medium ${result.passed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {result.passed ? 'PASSED' : 'FAILED'}
        </span>
      </div>
      <div className="space-y-1">
        {result.details.map((detail, index) => (
          <div key={index} className="text-sm text-gray-700">
            {detail}
          </div>
        ))}
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Running security tests...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-red-600 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Security Test Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={runTests}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Retry Tests
          </button>
        </div>
      </div>
    )
  }

  if (!report) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Security Dashboard</h1>
            <button
              onClick={runTests}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Running...' : 'Run Tests Again'}
            </button>
          </div>
          
          <div className={`rounded-lg p-4 ${report.overall ? 'bg-green-100 border border-green-200' : 'bg-red-100 border border-red-200'}`}>
            <div className="flex items-center">
              <div className={`w-3 h-3 rounded-full mr-3 ${report.overall ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className={`font-semibold ${report.overall ? 'text-green-800' : 'text-red-800'}`}>
                Overall Security Status: {report.overall ? 'SECURE' : 'VULNERABILITIES DETECTED'}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <TestSection title="CSP Headers & XSS Protection" result={report.results.csp} />
          <TestSection title="Secure Storage" result={report.results.storage} />
          <TestSection title="Rate Limiting" result={report.results.rateLimit} />
          <TestSection title="CSRF Protection" result={report.results.csrf} />
          <TestSection title="XSS Input Sanitization" result={report.results.xss} />
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">Security Recommendations</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Regularly update dependencies to patch security vulnerabilities</li>
            <li>• Monitor security headers and CSP policies</li>
            <li>• Implement proper error handling to prevent information disclosure</li>
            <li>• Use HTTPS in production environments</li>
            <li>• Regular security audits and penetration testing</li>
            <li>• Implement proper logging and monitoring for security events</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
