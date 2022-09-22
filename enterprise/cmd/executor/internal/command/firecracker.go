package command

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/inconshreveable/log15"

	shellquote "github.com/kballard/go-shellquote"

	"github.com/sourcegraph/sourcegraph/internal/lazyregexp"
	"github.com/sourcegraph/sourcegraph/lib/errors"
)

type commandRunner interface {
	RunCommand(ctx context.Context, command command, logger Logger) error
}

const firecrackerContainerDir = "/work"

// formatFirecrackerCommand constructs the command to run on the host via a Firecracker
// virtual machine in order to invoke the given spec. If the spec specifies an image, then
// the command will be run inside of a container inside of the VM. Otherwise, the command
// will be run inside of the VM. The containers are one-shot and subject to the resource
// limits specified in the given options.
//
// The name value supplied here refers to the Firecracker virtual machine, which must have
// also been the name supplied to a successful invocation of setupFirecracker. Additionally,
// the virtual machine must not yet have been torn down (via teardownFirecracker).
func formatFirecrackerCommand(spec CommandSpec, name string, options Options) command {
	rawOrDockerCommand := formatRawOrDockerCommand(spec, firecrackerContainerDir, options)

	innerCommand := shellquote.Join(rawOrDockerCommand.Command...)
	if len(rawOrDockerCommand.Env) > 0 {
		// If we have env vars that are arguments to the command we need to escape them
		quotedEnv := quoteEnv(rawOrDockerCommand.Env)
		innerCommand = fmt.Sprintf("%s %s", strings.Join(quotedEnv, " "), innerCommand)
	}
	if rawOrDockerCommand.Dir != "" {
		innerCommand = fmt.Sprintf("cd %s && %s", rawOrDockerCommand.Dir, innerCommand)
	}

	return command{
		Key:       spec.Key,
		Command:   []string{"ignite", "exec", name, "--", innerCommand},
		Operation: spec.Operation,
	}
}

// dockerDaemonConfig is a struct that marshals into a valid docker daemon config.
type dockerDaemonConfig struct {
	RegistryMirrors []string `json:"registry-mirrors"`
}

// dockerDaemonConfigFilename is the filename in the firecracker state tmp directory
// for the optional docker daemon config file.
const dockerDaemonConfigFilename = "docker-daemon.json"

func newDockerDaemonConfig(tmpDir, mirrorAddress string) (_ string, err error) {
	f, err := os.Create(path.Join(tmpDir, dockerDaemonConfigFilename))
	if err != nil {
		return "", errors.Wrap(err, "creating temp file for docker daemon config")
	}
	defer func() {
		err = errors.Append(err, f.Close())
	}()
	daemonConfigFile := f.Name()

	c, err := json.Marshal(&dockerDaemonConfig{RegistryMirrors: []string{mirrorAddress}})
	if err != nil {
		return daemonConfigFile, errors.Wrap(err, "marshalling docker daemon config")
	}

	return daemonConfigFile, os.WriteFile(daemonConfigFile, c, os.ModePerm)
}

// setupFirecracker invokes a set of commands to provision and prepare a Firecracker virtual
// machine instance. If a startup script path (an executable file on the host) is supplied,
// it will be mounted into the new virtual machine instance and executed. Optionally,
// a docker daemon config is created for FirecrackerOptions.DockerRegistryMirrorAddress
// and mounted into the VM.
func setupFirecracker(ctx context.Context, runner commandRunner, logger Logger, name, workspaceDevice, tmpDir string, options Options, operations *Operations) error {
	var daemonConfigFile string
	if options.FirecrackerOptions.DockerRegistryMirrorAddress != "" {
		var err error
		daemonConfigFile, err = newDockerDaemonConfig(tmpDir, options.FirecrackerOptions.DockerRegistryMirrorAddress)
		if err != nil {
			return err
		}
	}

	// Start the VM and wait for the SSH server to become available.
	startCommand := command{
		Key: "setup.firecracker.start",
		Command: flatten(
			"ignite", "run",
			"--runtime", "docker",
			"--network-plugin", "cni",
			firecrackerResourceFlags(options.ResourceOptions),
			firecrackerCopyfileFlags(options.FirecrackerOptions.VMStartupScriptPath, daemonConfigFile),
			firecrackerVolumeFlags(workspaceDevice, firecrackerContainerDir),
			"--ssh",
			"--name", name,
			"--kernel-image", sanitizeImage(options.FirecrackerOptions.KernelImage),
			sanitizeImage(options.FirecrackerOptions.Image),
		),
		Operation: operations.SetupFirecrackerStart,
	}

	if err := runner.RunCommand(ctx, startCommand, logger); err != nil {
		return errors.Wrap(err, "failed to start firecracker vm")
	}

	if options.FirecrackerOptions.VMStartupScriptPath != "" {
		startupScriptCommand := command{
			Key:       "setup.startup-script",
			Command:   flatten("ignite", "exec", name, "--", options.FirecrackerOptions.VMStartupScriptPath),
			Operation: operations.SetupStartupScript,
		}
		if err := runner.RunCommand(ctx, startupScriptCommand, logger); err != nil {
			return errors.Wrap(err, "failed to run startup script")
		}
	}

	return nil
}

// teardownFirecracker issues a stop and a remove request for the Firecracker VM with
// the given name and removes the tmpDir.
func teardownFirecracker(ctx context.Context, runner commandRunner, logger Logger, name, tmpDir string, operations *Operations) error {
	removeCommand := command{
		Key:       "teardown.firecracker.remove",
		Command:   flatten("ignite", "rm", "-f", name),
		Operation: operations.TeardownFirecrackerRemove,
	}
	if err := runner.RunCommand(ctx, removeCommand, logger); err != nil {
		log15.Error("Failed to remove firecracker vm", "name", name, "err", err)
	}

	if err := os.RemoveAll(tmpDir); err != nil {
		log15.Error("Failed to remove firecracker state tmp dir", "name", name, "err", err)
	}

	return nil
}

func firecrackerResourceFlags(options ResourceOptions) []string {
	return []string{
		"--cpus", strconv.Itoa(options.NumCPUs),
		"--memory", options.Memory,
		"--size", options.DiskSpace,
	}
}

func firecrackerCopyfileFlags(vmStartupScriptPath, daemonConfigFile string) []string {
	copyfiles := make([]string, 0, 2)
	if vmStartupScriptPath != "" {
		copyfiles = append(copyfiles, fmt.Sprintf("%s:%s", vmStartupScriptPath, vmStartupScriptPath))
	}

	if daemonConfigFile != "" {
		copyfiles = append(copyfiles, fmt.Sprintf("%s:%s", daemonConfigFile, "/etc/docker/daemon.json"))
	}

	sort.Strings(copyfiles)
	return intersperse("--copy-files", copyfiles)
}

func firecrackerVolumeFlags(workspaceDevice, firecrackerContainerDir string) []string {
	return []string{"--volumes", fmt.Sprintf("%s:%s", workspaceDevice, firecrackerContainerDir)}
}

var imagePattern = lazyregexp.New(`([^:@]+)(?::([^@]+))?(?:@sha256:([a-z0-9]{64}))?`)

// sanitizeImage sanitizes the given docker image for use by ignite. The ignite utility
// has some issue parsing docker tags that include a sha256 hash, so we try to remove it
// from any of the image references before passing it to the ignite command.
func sanitizeImage(image string) string {
	if matches := imagePattern.FindStringSubmatch(image); len(matches) == 4 {
		if matches[2] == "" {
			return matches[1]
		}

		return fmt.Sprintf("%s:%s", matches[1], matches[2])
	}

	return image
}
