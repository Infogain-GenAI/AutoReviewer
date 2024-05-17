import { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate } from 'langchain/prompts'
import { LLMChain } from 'langchain/chains'
import { BaseChatModel } from 'langchain/dist/chat_models/base'
import type { ChainValues } from 'langchain/dist/schema'
import { PullRequestFile } from './pullRequestService'
import parseDiff from 'parse-diff'
import { LanguageDetectionService } from './languageDetectionService'
import { exponentialBackoffWithJitter } from '../httpUtils'
import { Effect, Context } from 'effect'
import { NoSuchElementException, UnknownException } from 'effect/Cause'

export interface CodeReviewService {
  codeReviewFor(
    file: PullRequestFile
  ): Effect.Effect<ChainValues, NoSuchElementException | UnknownException, LanguageDetectionService>
  codeReviewForChunks(
    file: PullRequestFile
  ): Effect.Effect<ChainValues, NoSuchElementException | UnknownException, LanguageDetectionService>
}

export const CodeReviewService = Context.GenericTag<CodeReviewService>('CodeReviewService')

export class CodeReviewServiceImpl {
  private llm: BaseChatModel
  private chatPrompt = ChatPromptTemplate.fromPromptMessages([
    SystemMessagePromptTemplate.fromTemplate(
      "Act as an empathetic software engineer that's an expert in designing and developing React based frontend softwares based on Redux Middleware and Saga framework and adhering to best practices of software architecture."
    ),
    HumanMessagePromptTemplate.fromTemplate(`Your task is to review a Pull Request. You will receive a git diff.
    Review it and suggest any improvements in code quality, maintainability, readability, performance, security, etc.
    Identify any potential bugs or security vulnerabilities. Check it adheres to the following coding standards and guidelines:
1.Ensure that HTML elements are used semantically to provide a clear and meaningful structure to the application.
2.Verify that React components use appropriate HTML elements (<div>, <span>, <button>, etc.) based on their intended purpose.
3.Review form components to ensure they include accessible labels (<label>) associated with form inputs using htmlFor or aria-labelledby attributes.
4.Follow a consistent naming convention, such as camelCase or PascalCase, throughout the codebase.
5.Define actions and action types in separate files for better organization and maintainability.
6.Group related actions and action types together.
7.Use action creators to encapsulate action creation logic.
8.Create separate Reducer Functions for each slice of state.
9.Utilize Redux Middleware for tasks such as logging, crash reporting, or async actions.
10.Keep middleware logic separate from component logic to maintain separation of concerns.
11.Document middleware usage and purpose for clarity.
12.Organize sagas in a dedicated directory.
13.Define Sagas for handling asynchronous logic such as API calls and side effects.
14.Use takeEvery, takeLatest, takeLeading, or other Saga effects to manage different scenarios of action handling.
15.Keep Sagas lean and focused on a single task.
16.Follow the container/presentational component pattern for separating UI logic from data logic.
17.Container components connect to Redux store and pass data to presentational components via props.
18.Keep components small, focused, and reusable.
19.Write code with clarity and simplicity in mind.
20.Suggest adding comments to the code only when you consider it a significant improvement.
21.Avoid overly complex and convoluted code logic.
22.Write your reply and examples in GitHub Markdown format.

The programming language in the git diff is {lang}.

    git diff to review

    {diff}`)
  ])

  private chain: LLMChain<string>

  constructor(llm: BaseChatModel) {
    this.llm = llm
    this.chain = new LLMChain({
      prompt: this.chatPrompt,
      llm: this.llm
    })
  }

  codeReviewFor = (
    file: PullRequestFile
  ): Effect.Effect<ChainValues, NoSuchElementException | UnknownException, LanguageDetectionService> =>
    LanguageDetectionService.pipe(
      Effect.flatMap(languageDetectionService => languageDetectionService.detectLanguage(file.filename)),
      Effect.flatMap(lang =>
        Effect.retry(
          Effect.tryPromise(() => this.chain.call({ lang, diff: file.patch })),
          exponentialBackoffWithJitter(3)
        )
      )
    )

  codeReviewForChunks(
    file: PullRequestFile
  ): Effect.Effect<ChainValues[], NoSuchElementException | UnknownException, LanguageDetectionService> {
    const programmingLanguage = LanguageDetectionService.pipe(
      Effect.flatMap(languageDetectionService => languageDetectionService.detectLanguage(file.filename))
    )
    const fileDiff = Effect.sync(() => parseDiff(file.patch)[0])

    return Effect.all([programmingLanguage, fileDiff]).pipe(
      Effect.flatMap(([lang, fd]) =>
        Effect.all(fd.chunks.map(chunk => Effect.tryPromise(() => this.chain.call({ lang, diff: chunk.content }))))
      )
    )
  }
}
