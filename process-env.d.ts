export {}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      AZURE_OPENAI_API_KEY: string
      AZURE_OPENAI_API_INSTANCE_NAME: string
      AZURE_OPENAI_API_DEPLOYMENT_NAME: string
      AZURE_OPENAI_API_VERSION: string
    }
  }
}
