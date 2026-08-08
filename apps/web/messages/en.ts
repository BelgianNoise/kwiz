import type { ErrorCode } from '@kwiz/domain'

/**
 * Keys are `<surface>.<section>.<key>` (conventions §6.1), flat within a section and never
 * deeper than three levels, so any key is greppable.
 *
 * `admin`, `control`, `screen` and `player` arrive with the surfaces that need them — an
 * empty section written now is a stub.
 *
 * **No hardcoded user-facing string anywhere, including scaffolding.** The rule only holds
 * if it holds from the first page.
 */

/**
 * conventions §6.1 — **`errors.<CODE>` mirrors the `ErrorCode` catalogue exactly**, and the
 * annotation is what makes "exactly" true: a code added to conventions §4 without copy here
 * is a compile error, not a raw `SCREAMING_SNAKE` string in front of a room.
 *
 * A server `message` is English, for logs, and a client must never show it (protocol §7.3).
 * This is where user-facing copy lives, which is also why several of these say less than the
 * server does: *"That code doesn't match a game"* is more use to a player than the id that
 * failed to resolve.
 */
const errors: Record<ErrorCode, string> = {
  GAME_NOT_FOUND: "That code doesn't match a game. Check the screen and try again.",
  GAME_NOT_JOINABLE: 'That game has already finished.',
  GAME_NOT_LIVE: 'That game is not running.',
  TEAM_NOT_FOUND: 'That team is no longer in this game.',
  UNKNOWN_DEVICE: 'This device is no longer in the game. Join again to carry on.',
  TEAM_FULL: 'That team already has the maximum number of phones.',
  QUESTION_NOT_OPEN: 'That question is not open.',
  QUESTION_LOCKED: 'Too late — the quiz master has closed this question.',
  ALREADY_SUBMITTED: 'Your team has already answered this one.',
  BUZZERS_NOT_LIVE: 'Buzzers are not live right now.',
  TEAM_LOCKED_OUT:
    'Your answer was incorrect, so you cannot buzz again on this question.',
  NOT_IN_SETUP: 'That can only be changed before the game starts.',
  RESYNC_BLOCKED:
    'This game has already been played, so it cannot be refreshed from the quiz.',
  SOURCE_QUIZ_DELETED: 'The quiz this game came from no longer exists.',
  QUESTION_STILL_OPEN: 'Lock or skip the open question first.',
  SCORE_OUT_OF_RANGE: 'That score is outside the range this question allows.',
  NOT_A_FINALE_ROUND: 'That only applies to the finale.',
  TOO_FEW_FINALISTS: 'Pick at least two finalists.',
  FINALISTS_ALREADY_SET: 'The finalists are already set for this round.',
  TEAM_NOT_A_FINALIST: 'That team is not in the finale.',
  TEAM_ELIMINATED: 'That team is out of the finale.',
  NOT_TEAMS_TURN: "It is not that team's turn.",
  NO_TURN_ACTIVE: 'Start a turn first.',
  KEYWORD_ALREADY_MARKED: 'That keyword has already been credited to another team.',
  SCHEMA_VERSION_UNSUPPORTED: 'This file was made by a newer version of Kwiz.',
  CHECKSUM_MISMATCH: 'Some files in this export are damaged.',
  IMPORT_COLLISION: 'You already have this quiz. Replace it, or import a copy?',
  MANIFEST_INVALID: 'This file is not a Kwiz export.',
  VALIDATION_ERROR: 'Something went wrong with that request.',
  DATABASE_MIGRATION_REQUIRED: 'The database needs migrating before Kwiz can run.',
  ATTACHMENT_REJECTED: 'That file is not a supported image, audio or video file.',
  ATTACHMENT_NOT_FOUND: 'That file is missing.',
}

const en = {
  errors,

  common: {
    appName: 'Kwiz',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    create: 'Create',
    add: 'Add',
    rename: 'Rename',
    close: 'Close',
    back: 'Back',
    saved: 'Saved',
    saving: 'Saving…',
    saveFailed: 'Not saved — check your connection.',
    teams: 'Teams',
    moveUp: 'Move up',
    moveDown: 'Move down',

    /**
     * Language names are **never translated** and are identical in every catalogue
     * (PRD 1 §9.4): both locales must be reachable from a device that cannot read the
     * current one. Never a flag icon alone — flags mean countries, not languages.
     */
    language: {
      label: 'Language',
      en: 'English',
      nl: 'Nederlands',
    },
  },

  /** PRD 2 §3 — the only page a guest and a master both see. */
  landing: {
    playing: {
      title: "I'm playing",
      detail: 'Scan the QR code on screen, or enter the code.',
      codeLabel: 'Game code',
      join: 'Join',
      invalid: "That code doesn't look right.",
    },
    hosting: {
      title: "I'm hosting",
      detail: 'Manage my quizzes and run a game.',
      open: 'Open',
    },
  },

  admin: {
    /** PRD 2 §5 — quizzes above games, and finished games out of the way. */
    dashboard: {
      title: 'Kwiz',
      quizzes: 'Quizzes',
      newQuiz: 'New quiz',
      import: 'Import…',
      games: 'Games',
      showFinished: 'Show finished',
      hideFinished: 'Hide finished',
      play: 'Play',
      open: 'Open',
      rounds: '{count, plural, one {# round} other {# rounds}}',
      questions: '{count, plural, one {# question} other {# questions}}',
      teamCount: '{count, plural, one {# team} other {# teams}}',
      edited: 'edited {date}',
      code: 'code {code}',
      templateUpdated: 'Template updated',
      resync: 'Re-sync',
      duplicate: 'Duplicate',
      export: 'Export',
      /** §5 — a real screen, and the moment the database is created (PRD 1 §6.6). */
      emptyQuizzes: 'No quizzes yet.',
      emptyQuizzesDetail: 'Create one, or import a .zip you exported elsewhere.',
      emptyGames: 'No games yet. Press Play on a quiz to set one up.',
      newQuizTitle: 'New quiz',
      newQuizLabel: 'Name',
      newQuizPlaceholder: 'Pub Quiz #4',
      deleteQuizTitle: 'Delete “{name}”?',
      /**
       * §5 names what survives, because masters assume deleting a quiz takes their history with
       * it and therefore never clean up. Games keep their own copies (data model §10).
       */
      deleteQuizKeepsGames:
        '{count, plural, =0 {This quiz has no played games.} one {# played game will be kept and stays reviewable.} other {# played games will be kept and stay reviewable.}}',
      status: {
        SETUP: 'Setup',
        LIVE: 'Live',
        FINISHED: 'Finished',
        ABANDONED: 'Abandoned',
      },
    },

    /** PRD 2 §6 — the round list, and the finale's one legal position. */
    quiz: {
      backToDashboard: 'Dashboard',
      name: 'Name',
      description: 'Description',
      rounds: 'Rounds',
      addRound: 'Add round',
      openRound: 'Open',
      /** §6 — balance between rounds is the thing a master worries about while authoring. */
      totals: '{questions} questions · {points} points · est. {minutes} min',
      roundSummary: '{questions} questions · {points} pts',
      /** A finale scores seconds, not points (D51), so `0 pts` would read as a mistake. */
      roundSummaryFinale: '{questions} questions',
      empty: 'No rounds yet. Add one to start writing questions.',
      addRoundTitle: 'Add a round',
      roundTypeLabel: 'Type',
      roundTitleLabel: 'Title',
      roundTitlePlaceholder: 'Music',
      type: {
        QUESTION_SET: 'Questions',
        JEOPARDY: 'Jeopardy board',
        DSMTW_FINALE: 'Finale',
      },
      typeHint: {
        QUESTION_SET: 'A list of questions, any answer method.',
        JEOPARDY: 'A board of categories and values. Every tile is a buzzer question.',
        DSMTW_FINALE: 'The timed keyword round. Always last, and only one per quiz.',
      },
      /** §6.1 — a one-line reason, rather than a silently missing option. */
      finaleExists: 'This quiz already ends with a finale.',
      finalePinned: 'Pinned as the last round',
      deleteRoundTitle: 'Delete “{title}”?',
      deleteRoundBody:
        '{count, plural, =0 {This round has no questions.} one {Its # question is deleted too.} other {Its # questions are deleted too.}}',
      preflight: 'Check',
    },

    /** PRD 2 §7 — the QUESTION_SET round editor and its side sheet. */
    round: {
      backToQuiz: 'Quiz',
      title: 'Title',
      defaultPoints: 'Default points',
      defaultTimer: 'Default timer',
      seconds: 's',
      noTimer: 'No timer',
      questions: 'Questions',
      addQuestion: 'Add question',
      empty: 'No questions yet.',
      untitled: 'Untitled question',
      /** §7 — a round default silently rewriting a round's scoring is a nasty surprise. */
      cascadeTitle: 'Change the default for this round?',
      cascadeBody:
        '{count, plural, =0 {No questions inherit this default.} one {# question will change from {from} to {to}.} other {# questions will change from {from} to {to}.}}',
      deleteQuestionTitle: 'Delete this question?',
      ready: 'Ready',
      incomplete: 'Incomplete',
    },

    /** PRD 2 §7.1 — the question sheet, over the list rather than on its own page. */
    question: {
      heading: 'Question {index} of {total}',
      previous: 'Previous question',
      next: 'Next question',
      prompt: 'Prompt',
      promptPlaceholder: 'Who released "Kid A" in 2000?',
      answerMethod: 'Answer method',
      method: {
        FREE_TEXT: 'Free text',
        MULTIPLE_CHOICE: 'Multiple choice',
        BUZZER: 'Buzzer',
        DO: 'Do / challenge',
        KEYWORDS: 'Keywords',
      },
      points: 'Points',
      timer: 'Timer',
      noTimer: 'No timer',
      /** §8 and §9.1 — stated as a fact, not shown as a disabled control (D34, I18). */
      lockedBuzzer: 'Jeopardy tiles are always buzzer questions.',
      lockedKeywords: 'A finale question is always a keyword question.',
      correctAnswer: 'Correct answer',
      alsoAccept: 'Also accept',
      addAlternative: 'Add alternative',
      /** §7.2 — telling the master here turns a live-game problem into an authoring one (D22). */
      matchingNote:
        'Matching is exact after lowercasing and trimming. Anything else comes to you to accept or deny during the game.',
      buzzerNote:
        'You will judge spoken answers yourself. This is shown on your control screen and revealed to the room afterwards.',
      options: 'Options',
      optionsHint: 'Two to four, and pick the correct one.',
      addOption: 'Add option',
      scoring: 'Scoring',
      scoringMode: {
        WINNER_TAKES_ALL: 'Winner takes all',
        PER_TEAM_SCORE: 'Score each team',
      },
      tiePayout: 'If several teams tie',
      payout: { FULL: 'Each gets full points', SPLIT: 'Split the points' },
      /** §7.2 — `points` doubling as the per-team maximum is genuinely non-obvious (D24). */
      perTeamNote:
        'Each team gets 0-{points} points. Change "Points" above to change the maximum.',
      attachments: 'Attachments',
      addAttachment: 'Add file',
      /** O6 — verified in the browser before it is uploaded at all. */
      checking: 'Checking...',
      playable: 'Playable',
      showOnPlayers: 'Show on player devices',
      showOnPlayersHint: 'Images only. Audio and video play on the main screen.',
      deleteAttachment: 'Remove file',
      masterNotes: 'Master notes',
      /** §7.1 — labelled with its guarantee, which is why a master will trust it (invariant 7). */
      masterNotesHint: 'Never shown to anyone else.',
      keywords: 'Keywords',
      keywordsHint: 'Exactly five.',
      keywordRequired: 'Required',
      wordShape: '{count, plural, one {# word} other {# words}}',
      /** §9.1 — the shape is what the room sees, and it changes authoring decisions (D53). */
      keywordShapeNote:
        'The room sees blurred word shapes until you mark each one. "wrought iron" shows as two blurred words of 7 and 4 letters.',
    },

    /** PRD 2 §8 — the board is authored as a board, because that is what the room will see. */
    board: {
      valueLadder: 'Value ladder',
      addRow: 'Add row',
      addCategory: 'Add category',
      categoryName: 'Category name',
      renameCategory: 'Rename category',
      deleteCategoryTitle: 'Delete "{name}"?',
      deleteCategoryBody:
        '{count, plural, =0 {It has no tiles.} one {Its # tile is deleted too.} other {Its # tiles are deleted too.}}',
      everyTileBuzzer: 'Every tile is a buzzer question - any team can buzz in.',
      addTile: 'Add a tile',
      emptyBoard: 'No categories yet. Add one to start building the board.',
      emptyTiles: '{count, plural, one {# empty tile} other {# empty tiles}}',
      incompleteTiles:
        '{count, plural, one {# incomplete question} other {# incomplete questions}}',
    },

    /** PRD 2 §9 — the finale editor: a list of keyword questions plus the two numbers. */
    finale: {
      pinnedNote: 'Pinned as the last round. A quiz can have at most one finale.',
      rate: 'Points to seconds',
      rateSuffix: 'points = 1 second',
      /** §9 — the conversion shown *working*, not just entered. */
      rateWorked: 'A team on {score} pts starts with {seconds}s.',
      rateQuizTotal:
        'Your quiz is worth {points} pts - a strong team is about {seconds}s.',
      penalty: 'Penalty per keyword',
      penaltySuffix: 's off every other team',
      penaltyNote: 'Set at game setup too, once you know how many teams play.',
      suggested: '{have} of ~{suggested} suggested',
      assumeTeams: 'Assume {count} teams',
      /** §9 — a shortfall is a warning, never a block: over-supplying costs nothing (D58). */
      shortfall:
        'For {teams} teams at {penalty}s, about {suggested} questions are usually needed to get down to one survivor. You have {have}.',
      keywordCount: '{count, plural, one {# keyword} other {# keywords}}',
    },
  },
}

export type Messages = typeof en

export default en
