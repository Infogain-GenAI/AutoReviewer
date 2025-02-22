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
      `Act as an empathetic software engineer that's an expert in designing and developing React based frontend softwares based on Redux Middleware and Saga framework, while strictly following best practices of software architecture`
    ),
    HumanMessagePromptTemplate.fromTemplate(`Your task is to review a Pull Request.
    Your task is to review a Pull Request for technical inconsistencies.
    You will receive a git diff. You're expected to conduct a technical review to suggest enhancements in various aspects such as code quality, maintainability, readability, performance, and security.
    This includes identifying potential bugs or security vulnerabilities.
    For technical reviews, instructions will be outlined in the form of coding standards and guidelines for React, Redux and Saga.
    Ensure adherence to technical coding standards and guidelines.
    -Technical Coding Standards and Guidelines for Redux, React, and Saga are as below:
    1. Redux Setup:
    a.Check that Redux is set up correctly with reducers, actions, and the store.
    b.Verify that action types are defined as constants and are consistent across the application.
    c.Ensure that action creators are used to encapsulate action logic and avoid direct manipulation of action objects.
    2. Redux Middleware:
    a.Review the usage of Redux Middleware for tasks such as logging, error handling, or asynchronous operations.
    b.Ensure that middleware functions are pure and do not cause side effects unrelated to Redux state management.
    c.Check for proper error handling in middleware to prevent application crashes and provide meaningful error messages to users.
    3. Saga Implementation:
    a.Evaluate the usage of Redux Saga for handling asynchronous logic and side effects.
    b.Verify that sagas are structured appropriately, with clear separation of concerns and minimal coupling between sagas.
    c.Check for proper error handling in sagas, including handling of failed API requests and other asynchronous operations.
    4.Component Architecture:
    a.Review the component architecture to ensure adherence to best practices and maintainability.
    b.Check for proper separation of container and presentational components, with container components responsible for connecting to Redux and managing state.
    c.Ensure that components are reusable, composable, and focused on a single responsibility.
    5.State Management:
    a.Evaluate the usage of Redux for state management, considering factors such as the size and complexity of the application.
    b.Check for appropriate normalization of state, especially for nested or relational data structures.
    c.Verify that selectors are used to derive derived data from the Redux store efficiently.
    6.Code Organization and Structure:
    a.Check that the project structure follows best practices and is organized logically.
    b.Ensure that files and folders are named descriptively and consistently.
    c.Verify that code is modular and follows the single responsibility principle, with each module responsible for a specific feature or functionality.
    7.Error Handling:
    a.Evaluate error handling mechanisms throughout the codebase, including in Redux actions, reducers, middleware, and sagas.
    b.Check for consistent error handling patterns and ensure that errors are handled gracefully to prevent application crashes and provide a good user experience.
    8.Performance Optimization:
    a. Review code for potential performance bottlenecks and inefficiencies.
    b. Check for unnecessary re-renders in React components and identify opportunities for optimization using techniques such as memoization and PureComponent.
    c. Evaluate the usage of Redux selectors and memoization to improve performance when accessing derived data from the store.
    9.Testing:
    a.Verify that the codebase is adequately covered by unit tests, integration tests, and end-to-end tests.
    b.Check for proper mocking of external dependencies, such as APIs and services, in tests to ensure isolation and reproducibility.
    c.Evaluate test coverage and identify areas where additional tests are needed to improve code quality and reliability.
    10.Documentation and Comments:
    a.Ensure that code is well-documented with comments, especially for complex logic or algorithms.
    b.Check that documentation is up-to-date and accurately reflects the behavior and usage of functions, components, and modules.
    c.Encourage the use of README files and other documentation to provide an overview of the project structure, architecture, and development workflow.

Write your reply and examples in GitHub Markdown format.
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

  // codeReviewFor = (
  //   file: PullRequestFile
  // ): Effect.Effect<ChainValues, NoSuchElementException | UnknownException, LanguageDetectionService> =>
  //   LanguageDetectionService.pipe(
  //     Effect.flatMap(languageDetectionService => languageDetectionService.detectLanguage(file.filename)),
  //     Effect.flatMap(lang =>
  //       Effect.retry(
  //         Effect.tryPromise(() => this.chain.call({ lang, diff: file.patch })),
  //         exponentialBackoffWithJitter(3)
  //       )
  //     )
  //   )

  ///start changed - codeReviewFor
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

  ///end changed - codeReviewFor

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
