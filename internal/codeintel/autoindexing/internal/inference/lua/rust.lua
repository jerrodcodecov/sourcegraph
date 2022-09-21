local pattern = require "sg.autoindex.patterns"
local recognizer = require "sg.autoindex.recognizer"

local indexer = "sourcegraph/lsif-rust"
local outfile = "dump.lsif"

return recognizer.new_path_recognizer {
  patterns = {
    pattern.new_path_basename "Cargo.toml",
  },

  -- Invoked when Cargo.toml exists anywhere in repository
  generate = function(_, _)
    return {
      steps = {},
      root = "",
      indexer = indexer,
      indexer_args = { "lsif-rust", "index" },
      outfile = outfile,
    }
  end,
}
