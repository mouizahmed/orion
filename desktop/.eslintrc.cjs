module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': 'off',
  },
  overrides: [
    {
      files: ['src/**/*.{tsx}'],
      rules: {
        'no-restricted-imports': ['error', {
          paths: [
            {
              name: '@/features/notes/api/notes-client',
              importNames: ['createNote', 'updateNote', 'deleteNote', 'enhanceNote', 'revertToVersion', 'addNoteAttendee', 'removeNoteAttendee'],
              message: 'Components must use the canonical note mutation hooks.',
            },
            {
              name: '@/features/notes/api/folders-client',
              importNames: ['createFolder', 'renameFolder', 'deleteFolder'],
              message: 'Components must use the canonical folder mutation hooks.',
            },
            {
              name: '@/features/chat/chat-client',
              importNames: ['createConversation', 'deleteConversation', 'renameConversation', 'getMessages', 'listConversations'],
              message: 'Components and contexts must use the canonical persisted-chat query hooks.',
            },
          ],
        }],
      },
    },
    {
      files: ['src/components/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            {
              group: ['@/features/*', '@/features/**', '@/app/*', '@/app/**'],
              message: 'Shared UI cannot depend on app or feature modules. Move feature-aware code to its owning feature.',
            },
          ],
        }],
      },
    },
  ],
}
