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
      "Act as an empathetic software engineer that's an expert in designing and developing React based frontend softwares using TypeScript programming language, Redux-Saga framework and adhering to best practices of software architecture."
    ),
    HumanMessagePromptTemplate.fromTemplate(`Your task is to review a Pull Request. You will receive a git diff.
    Review it and suggest any improvements in code quality, maintainability, readability, performance, security, etc.
    Identify any potential bugs or security vulnerabilities. Check it adheres to the following coding standards and guidelines based on Web Content Accessibility Guidelines (WCAG):
1.Ensure that HTML elements are used semantically to provide a clear and meaningful structure to the application.
2.Verify that React components use appropriate HTML elements (<div>, <span>, <button>, etc.) based on their intended purpose.
3.Review form components to ensure they include accessible labels (<label>) associated with form inputs using htmlFor or aria-labelledby attributes.
4.Check that form elements have accessible error messages and provide instructions for correct input.
5.Ensure all interactive elements are accessible via keyboard navigation, including buttons, links, and form controls.
6.Review event handlers to confirm they are triggered by keyboard events (e.g., onKeyPress, onKeyDown) in addition to mouse events.7.Verify that focus is appropriately managed within the application, especially during navigation and when interacting with modal dialogs or dynamic content.
8.Ensure that focus indicators are visible and clearly distinguishable for keyboard users.
9.Check text and background color combinations to ensure they meet WCAG contrast requirements (minimum 4.5:1 for normal text and 3:1 for large text).
10.Avoid conveying important information solely through color and provide alternative cues for users who may have color vision deficiencies.
11.Review image components to confirm they include descriptive alt attributes that convey the purpose or content of the image.
Ensure multimedia components (videos, audio) include accessible alternatives such as captions, transcripts, or audio descriptions.
12.Test components with screen readers to verify they are announced correctly and that users can navigate and interact with them effectively.
13.Use ARIA roles, states, and properties where necessary to enhance accessibility for screen reader users.
14.Review error handling mechanisms to ensure they provide clear and accessible error messages to users, especially in form validation and submission.
15.Consider using ARIA live regions or other techniques to dynamically announce updates or changes to users, such as form submission results or error messages.
16.Confirm that components and layouts are responsive and adapt well to different viewport sizes and devices.
17.Write code with clarity and simplicity in mind.
18.Avoid overly complex and convoluted code logic.
19.Suggest adding comments to the code only when you consider it a significant improvement.
20.Write your reply and examples in GitHub Markdown format.

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
