import { config } from 'dotenv'
import * as core from '@actions/core'
import * as github from '@actions/github'
import type { PullRequestEvent } from '@octokit/webhooks-definitions/schema'

import { ChatOpenAI } from 'langchain/chat_models/openai'
import { BaseChatModel } from 'langchain/chat_models/base'
import { CodeReviewService, CodeReviewServiceImpl } from './services/codeReviewService'
import { PullRequestService, PullRequestServiceImpl, octokitTag } from './services/pullRequestService'
import { LanguageDetectionService } from './services/languageDetectionService'

import { Effect, Layer, Match, pipe, Exit } from 'effect'

config()

export const run = async (): Promise<void> => {
  const openAIApiKey = core.getInput('openai_api_key')
  const githubToken = core.getInput('github_token')
  const modelName = core.getInput('model_name')
  const temperature = parseInt(core.getInput('model_temperature'))
  const azureOpenAIApiKey = core.getInput('azure_openai_api_key')
  const azureOpenAIApiInstanceName = core.getInput('azure_openai_api_instance_name')
  const azureOpenAIApiDeploymentName = core.getInput('azure_openai_api_deployment_name')
  const azureOpenAIApiVersion = core.getInput('azure_openai_api_version')

  const context = github.context
  const { owner, repo } = context.repo

  const model: BaseChatModel = new ChatOpenAI({
    temperature,
    azureOpenAIApiKey,
    azureOpenAIApiInstanceName,
    azureOpenAIApiDeploymentName,
    azureOpenAIApiVersion
  })

  const MainLive = initializeServices(model, githubToken)

  const program = Match.value(context.eventName).pipe(
    Match.when('workflow_dispatch', () => {
      const prNumber = parseInt(core.getInput('pr_number'))

      const excludeFilePatterns = pipe(
        Effect.sync(() => github.context.payload as PullRequestEvent),
        Effect.tap(pullRequestPayload =>
          Effect.sync(() => {
            core.info(
              `repoName: ${repo} pull_number: ${prNumber} owner: ${owner} `
            )
          })
        ),
        Effect.map(() =>
          core
            .getInput('exclude_files')
            .split(',')
            .map(_ => _.trim())
        )
      )

      const a = PullRequestService.pipe(
        Effect.flatMap(pullRequestService =>
          pullRequestService.getPullRequestCommitId(owner, repo, prNumber)
        ),
        Effect.flatMap(preqCommitId =>
          excludeFilePatterns.pipe(
            Effect.flatMap(filePattens =>
              PullRequestService.pipe(
                Effect.flatMap(pullRequestService =>
                  pullRequestService.getFilesForReview(owner, repo, prNumber, filePattens)
                ),
                Effect.flatMap(files => Effect.sync(() => files.filter(file => file.patch !== undefined))),
                Effect.flatMap(files =>
                  Effect.forEach(files, file =>
                    CodeReviewService.pipe(
                      Effect.flatMap(codeReviewService => codeReviewService.codeReviewFor(file)),
                      Effect.flatMap(res =>
                        PullRequestService.pipe(
                          Effect.flatMap(pullRequestService =>
                            pullRequestService.createReviewComment({
                              repo,
                              owner,
                              pull_number: prNumber,
                              commit_id: preqCommitId as string,
                              path: file.filename,
                              body: res.text,
                              start_line: 1, // Assuming line 1 for simplicity; adjust as needed
                              start_side: 'RIGHT',
                              line: 2,
                              side: 'RIGHT',
                            })
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
      return a
    }),

    Match.orElse(eventName =>
      Effect.sync(() => {
        core.setFailed(`This action only works on pull_request or workflow_dispatch events. Got: ${eventName}`)
      })
    )
  )

  const runnable = Effect.provide(program, MainLive)
  const result = await Effect.runPromiseExit(runnable)

  if (Exit.isFailure(result)) {
    core.setFailed(result.cause.toString())
  }
}

const initializeServices = (model: BaseChatModel, githubToken: string) => {
  const CodeReviewServiceLive = Layer.effect(
    CodeReviewService,
    Effect.map(LanguageDetectionService, _ => CodeReviewService.of(new CodeReviewServiceImpl(model)))
  )

  const octokitLive = Layer.succeed(octokitTag, github.getOctokit(githubToken))

  const PullRequestServiceLive = Layer.effect(
    PullRequestService,
    Effect.map(octokitTag, _ => PullRequestService.of(new PullRequestServiceImpl()))
  )

  const mainLive = CodeReviewServiceLive.pipe(
    Layer.merge(PullRequestServiceLive),
    Layer.merge(LanguageDetectionService.Live),
    Layer.merge(octokitLive),
    Layer.provide(LanguageDetectionService.Live),
    Layer.provide(octokitLive)
  )

  return mainLive
}

run()
