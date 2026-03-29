import { analytics } from './analytics'

interface FunnelDefinition {
  name: string
  description: string
  steps: FunnelStepDefinition[]
}

interface FunnelStepDefinition {
  name: string
  description: string
  required: boolean
  properties?: Record<string, any>
}

interface FunnelAnalytics {
  name: string
  totalUsers: number
  stepAnalytics: StepAnalytics[]
  conversionRate: number
  averageTime: number
  dropOffPoints: DropOffPoint[]
}

interface StepAnalytics {
  stepName: string
  stepNumber: number
  users: number
  conversionRate: number
  averageTime: number
  dropOffRate: number
}

interface DropOffPoint {
  stepName: string
  stepNumber: number
  dropOffCount: number
  dropOffRate: number
  reasons: string[]
}

class FunnelAnalysis {
  private static instance: FunnelAnalysis
  private funnels: Map<string, FunnelDefinition> = new Map()
  private funnelData: Map<string, Map<string, any>> = new Map()

  constructor() {
    this.initializeDefaultFunnels()
  }

  static getInstance(): FunnelAnalysis {
    if (!FunnelAnalysis.instance) {
      FunnelAnalysis.instance = new FunnelAnalysis()
    }
    return FunnelAnalysis.instance
  }

  private initializeDefaultFunnels(): void {
    // User Registration Funnel
    this.defineFunnel({
      name: 'user_registration',
      description: 'Complete user registration flow',
      steps: [
        { name: 'visit_signup', description: 'Visit signup page', required: true },
        { name: 'start_registration', description: 'Begin registration form', required: true },
        { name: 'enter_personal_info', description: 'Enter personal information', required: true },
        { name: 'enter_contact_info', description: 'Enter contact information', required: true },
        { name: 'verify_email', description: 'Verify email address', required: true },
        { name: 'complete_registration', description: 'Complete registration', required: true }
      ]
    })

    // Property Discovery Funnel
    this.defineFunnel({
      name: 'property_discovery',
      description: 'Property browsing and discovery',
      steps: [
        { name: 'visit_properties', description: 'Visit properties page', required: true },
        { name: 'search_properties', description: 'Search for properties', required: true },
        { name: 'view_property_details', description: 'View property details', required: true },
        { name: 'save_property', description: 'Save property to favorites', required: false },
        { name: 'contact_landlord', description: 'Contact landlord/agent', required: false }
      ]
    })

    // Rental Application Funnel
    this.defineFunnel({
      name: 'rental_application',
      description: 'Complete rental application process',
      steps: [
        { name: 'start_application', description: 'Start rental application', required: true },
        { name: 'fill_personal_details', description: 'Fill personal details', required: true },
        { name: 'upload_documents', description: 'Upload required documents', required: true },
        { name: 'submit_application', description: 'Submit application', required: true },
        { name: 'application_review', description: 'Application under review', required: true },
        { name: 'application_approved', description: 'Application approved', required: false }
      ]
    })

    // Payment Setup Funnel
    this.defineFunnel({
      name: 'payment_setup',
      description: 'Set up payment methods and plans',
      steps: [
        { name: 'initiate_payment', description: 'Initiate payment setup', required: true },
        { name: 'select_payment_plan', description: 'Select payment plan', required: true },
        { name: 'add_payment_method', description: 'Add payment method', required: true },
        { name: 'verify_payment', description: 'Verify payment method', required: true },
        { name: 'complete_setup', description: 'Complete payment setup', required: true }
      ]
    })

    // Staking Investment Funnel
    this.defineFunnel({
      name: 'staking_investment',
      description: 'Staking investment process',
      steps: [
        { name: 'visit_staking', description: 'Visit staking page', required: true },
        { name: 'learn_about_staking', description: 'Learn about staking', required: false },
        { name: 'connect_wallet', description: 'Connect wallet', required: true },
        { name: 'select_amount', description: 'Select investment amount', required: true },
        { name: 'confirm_transaction', description: 'Confirm transaction', required: true },
        { name: 'complete_staking', description: 'Complete staking', required: true }
      ]
    })

    // Whistleblower Funnel
    this.defineFunnel({
      name: 'whistleblower_report',
      description: 'Whistleblower reporting process',
      steps: [
        { name: 'visit_whistleblower', description: 'Visit whistleblower page', required: true },
        { name: 'start_report', description: 'Start report form', required: true },
        { name: 'provide_details', description: 'Provide report details', required: true },
        { name: 'upload_evidence', description: 'Upload evidence', required: false },
        { name: 'submit_report', description: 'Submit report', required: true },
        { name: 'report_submitted', description: 'Report successfully submitted', required: true }
      ]
    })
  }

  // Funnel Definition Management
  defineFunnel(funnel: FunnelDefinition): void {
    this.funnels.set(funnel.name, funnel)
  }

  getFunnelDefinition(name: string): FunnelDefinition | undefined {
    return this.funnels.get(name)
  }

  getAllFunnelDefinitions(): FunnelDefinition[] {
    return Array.from(this.funnels.values())
  }

  // Funnel Tracking
  startFunnel(funnelName: string, userId: string, properties?: Record<string, any>): void {
    const funnel = this.funnels.get(funnelName)
    if (!funnel) {
      console.warn(`Funnel "${funnelName}" not defined`)
      return
    }

    if (!this.funnelData.has(funnelName)) {
      this.funnelData.set(funnelName, new Map())
    }

    const userFunnelData = this.funnelData.get(funnelName)!
    userFunnelData.set(userId, {
      startedAt: Date.now(),
      currentStep: 0,
      completedSteps: [],
      properties: properties || {},
      droppedAt: null
    })

    analytics.startFunnel(funnelName, funnel.steps[0].name, {
      userId,
      ...properties
    })
  }

  trackStep(funnelName: string, userId: string, stepName: string, properties?: Record<string, any>): void {
    const funnel = this.funnels.get(funnelName)
    if (!funnel) {
      console.warn(`Funnel "${funnelName}" not defined`)
      return
    }

    const userFunnelData = this.funnelData.get(funnelName)
    if (!userFunnelData || !userFunnelData.has(userId)) {
      console.warn(`User "${userId}" not started funnel "${funnelName}"`)
      return
    }

    const userData = userFunnelData.get(userId)!
    const stepIndex = funnel.steps.findIndex(step => step.name === stepName)
    
    if (stepIndex === -1) {
      console.warn(`Step "${stepName}" not found in funnel "${funnelName}"`)
      return
    }

    // Update user data
    userData.currentStep = stepIndex
    userData.completedSteps.push({
      step: stepName,
      completedAt: Date.now(),
      properties: properties || {}
    })

    analytics.trackFunnelStep(funnelName, stepName, {
      userId,
      stepNumber: stepIndex + 1,
      ...properties
    })
  }

  completeFunnel(funnelName: string, userId: string, properties?: Record<string, any>): void {
    const funnel = this.funnels.get(funnelName)
    if (!funnel) {
      console.warn(`Funnel "${funnelName}" not defined`)
      return
    }

    const userFunnelData = this.funnelData.get(funnelName)
    if (!userFunnelData || !userFunnelData.has(userId)) {
      console.warn(`User "${userId}" not started funnel "${funnelName}"`)
      return
    }

    const userData = userFunnelData.get(userId)!
    userData.completedAt = Date.now()

    analytics.completeFunnel(funnelName, {
      userId,
      totalTime: userData.completedAt - userData.startedAt,
      ...properties
    })
  }

  dropOff(funnelName: string, userId: string, reason?: string): void {
    const userFunnelData = this.funnelData.get(funnelName)
    if (!userFunnelData || !userFunnelData.has(userId)) {
      return
    }

    const userData = userFunnelData.get(userId)!
    userData.droppedAt = Date.now()
    userData.dropOffReason = reason

    analytics.track('funnel_dropoff', {
      funnel: funnelName,
      userId,
      currentStep: userData.currentStep,
      reason: reason || 'unknown'
    })
  }

  // Funnel Analytics
  getFunnelAnalytics(funnelName: string): FunnelAnalytics | null {
    const funnel = this.funnels.get(funnelName)
    const userFunnelData = this.funnelData.get(funnelName)
    
    if (!funnel || !userFunnelData) {
      return null
    }

    const allUserData = Array.from(userFunnelData.values())
    const totalUsers = allUserData.length
    const completedUsers = allUserData.filter(data => data.completedAt).length

    // Step analytics
    const stepAnalytics: StepAnalytics[] = funnel.steps.map((step, index) => {
      const usersAtStep = allUserData.filter((data: any) => 
        data.currentStep >= index || data.completedSteps.some((cs: any) => cs.step === step.name)
      )
      
      const stepTime = usersAtStep.reduce((acc: number, data: any) => {
        const stepData = data.completedSteps.find((cs: any) => cs.step === step.name)
        if (stepData && data.startedAt) {
          return acc + (stepData.completedAt - data.startedAt)
        }
        return acc
      }, 0)

      const usersAtStepPlusOne = allUserData.filter((data: any) => 
        data.currentStep >= index + 1 || 
        (index + 1 < funnel.steps.length && data.completedSteps.some((cs: any) => cs.step === funnel.steps[index + 1].name))
      )

      return {
        stepName: step.name,
        stepNumber: index + 1,
        users: usersAtStep.length,
        conversionRate: usersAtStep.length / totalUsers,
        averageTime: usersAtStep.length > 0 ? stepTime / usersAtStep.length : 0,
        dropOffRate: (usersAtStep.length - usersAtStepPlusOne.length) / usersAtStep.length
      }
    })

    // Drop-off analysis
    const dropOffPoints: DropOffPoint[] = []
    for (let i = 0; i < funnel.steps.length - 1; i++) {
      const currentStep = funnel.steps[i]
      const nextStep = funnel.steps[i + 1]
      
      const usersAtCurrent = allUserData.filter((data: any) => 
        data.currentStep >= i || data.completedSteps.some((cs: any) => cs.step === currentStep.name)
      )
      
      const usersAtNext = allUserData.filter((data: any) => 
        data.currentStep >= i + 1 || data.completedSteps.some((cs: any) => cs.step === nextStep.name)
      )

      const dropOffCount = usersAtCurrent.length - usersAtNext.length
      if (dropOffCount > 0) {
        const dropOffReasons = allUserData
          .filter(data => data.droppedAt && data.currentStep === i)
          .map(data => data.dropOffReason || 'unknown')

        dropOffPoints.push({
          stepName: currentStep.name,
          stepNumber: i + 1,
          dropOffCount,
          dropOffRate: dropOffCount / usersAtCurrent.length,
          reasons: [...new Set(dropOffReasons)]
        })
      }
    }

    const totalTime = completedUsers.reduce((acc: number, data: any) => 
      acc + (data.completedAt! - data.startedAt), 0
    )

    return {
      name: funnelName,
      totalUsers,
      stepAnalytics,
      conversionRate: completedUsers / totalUsers,
      averageTime: completedUsers > 0 ? totalTime / completedUsers : 0,
      dropOffPoints
    }
  }

  getAllFunnelAnalytics(): Map<string, FunnelAnalytics> {
    const analytics = new Map<string, FunnelAnalytics>()
    
    this.funnels.forEach((funnel, name) => {
      const funnelAnalytics = this.getFunnelAnalytics(name)
      if (funnelAnalytics) {
        analytics.set(name, funnelAnalytics)
      }
    })

    return analytics
  }

  // Conversion Optimization Insights
  getOptimizationInsights(funnelName: string): {
    issues: string[]
    recommendations: string[]
    topDropOffPoints: DropOffPoint[]
  } {
    const funnelAnalytics = this.getFunnelAnalytics(funnelName)
    if (!funnelAnalytics) {
      return { issues: [], recommendations: [], topDropOffPoints: [] }
    }

    const issues: string[] = []
    const recommendations: string[] = []

    // Check for high drop-off rates
    funnelAnalytics.stepAnalytics.forEach((step, index) => {
      if (step.dropOffRate > 0.5) {
        issues.push(`High drop-off rate (${(step.dropOffRate * 100).toFixed(1)}%) at step: ${step.stepName}`)
        recommendations.push(`Optimize ${step.stepName} - consider simplifying the process or providing better guidance`)
      }
    })

    // Check for low overall conversion
    if (funnelAnalytics.conversionRate < 0.1) {
      issues.push(`Low overall conversion rate (${(funnelAnalytics.conversionRate * 100).toFixed(1)}%)`)
      recommendations.push('Review entire funnel for friction points and consider A/B testing improvements')
    }

    // Check for long completion times
    if (funnelAnalytics.averageTime > 300000) { // 5 minutes
      issues.push(`Long average completion time (${(funnelAnalytics.averageTime / 1000 / 60).toFixed(1)} minutes)`)
      recommendations.push('Streamline the process and reduce required steps or information')
    }

    // Sort drop-off points by severity
    const topDropOffPoints = funnelAnalytics.dropOffPoints
      .sort((a, b) => b.dropOffRate - a.dropOffRate)
      .slice(0, 3)

    return {
      issues,
      recommendations,
      topDropOffPoints
    }
  }

  // Export/Import functionality
  exportFunnelData(funnelName?: string): Record<string, any> {
    if (funnelName) {
      const data = this.funnelData.get(funnelName)
      return data ? Object.fromEntries(data) : {}
    }
    
    const allData: Record<string, any> = {}
    this.funnelData.forEach((data, name) => {
      allData[name] = Object.fromEntries(data)
    })
    return allData
  }

  clearFunnelData(funnelName?: string): void {
    if (funnelName) {
      this.funnelData.delete(funnelName)
    } else {
      this.funnelData.clear()
    }
  }
}

export const funnelAnalysis = FunnelAnalysis.getInstance()
export default FunnelAnalysis
