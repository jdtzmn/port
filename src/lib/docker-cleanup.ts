import { execAsync } from './exec.ts'
import { TRAEFIK_NETWORK } from './traefik.ts'
import type { DockerCleanupOptions, DockerCleanupResult, DockerProjectResources } from '../types.ts'

/**
 * Escape a shell argument to prevent command injection.
 * Wraps the argument in single quotes and escapes any single quotes within.
 */
function shellEscape(arg: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return `'${arg.replace(/'/g, "'\\''")}'`
}

/**
 * Check if Docker daemon is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info', { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * List volumes for a project using compose project label
 */
export async function listProjectVolumes(projectName: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker volume ls --filter label=com.docker.compose.project=${shellEscape(projectName)} --quiet`
    )
    return stdout
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
  } catch {
    return []
  }
}

/**
 * List networks for a project, excluding Traefik network
 */
export async function listProjectNetworks(projectName: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker network ls --filter label=com.docker.compose.project=${shellEscape(projectName)} --quiet --format "{{.Name}}"`
    )
    const networks = stdout
      .trim()
      .split('\n')
      .filter(line => line.length > 0)

    // Exclude Traefik network (CRITICAL SAFETY CHECK)
    return networks.filter(name => name !== TRAEFIK_NETWORK)
  } catch {
    return []
  }
}

/**
 * List stopped containers for a project
 */
export async function listProjectContainers(projectName: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --filter label=com.docker.compose.project=${shellEscape(projectName)} --quiet`
    )
    return stdout
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
  } catch {
    return []
  }
}

/**
 * List images for a project
 * Returns array of { id, name } objects
 */
export async function listProjectImages(
  projectName: string
): Promise<Array<{ id: string; name: string }>> {
  try {
    const { stdout } = await execAsync(
      `docker images --filter label=com.docker.compose.project=${shellEscape(projectName)} --format "{{.ID}}|{{.Repository}}:{{.Tag}}"`
    )

    const lines = stdout
      .trim()
      .split('\n')
      .filter(line => line.length > 0)

    return lines.map(line => {
      const [id, name] = line.split('|')
      return { id: id || '', name: name || '<none>' }
    })
  } catch {
    return []
  }
}

/**
 * Remove a Docker volume
 */
export async function removeVolume(volumeName: string): Promise<void> {
  await execAsync(`docker volume rm ${shellEscape(volumeName)}`)
}

/**
 * Remove a Docker network
 */
export async function removeNetwork(networkName: string): Promise<void> {
  await execAsync(`docker network rm ${shellEscape(networkName)}`)
}

/**
 * Remove a Docker container
 */
export async function removeContainer(containerId: string): Promise<void> {
  await execAsync(`docker rm ${shellEscape(containerId)}`)
}

/**
 * Remove a Docker image
 */
export async function removeImage(imageId: string): Promise<void> {
  await execAsync(`docker rmi ${shellEscape(imageId)}`)
}

/**
 * Get total size of images in bytes
 * Returns undefined if unable to determine size
 */
export async function getImagesSizeInBytes(imageIds: string[]): Promise<number | undefined> {
  if (imageIds.length === 0) {
    return undefined
  }

  try {
    // Use docker image inspect to get size for each image
    const escapedIds = imageIds.map(id => shellEscape(id)).join(' ')
    const { stdout } = await execAsync(`docker image inspect --format '{{.Size}}' ${escapedIds}`)

    const sizes = stdout
      .trim()
      .split('\n')
      .map(line => parseInt(line.trim(), 10))
      .filter(size => !isNaN(size) && size > 0)

    if (sizes.length === 0) {
      return undefined
    }

    return sizes.reduce((total, size) => total + size, 0)
  } catch {
    return undefined
  }
}

/**
 * Clean up all Docker resources for a project
 *
 * @param projectName - Docker Compose project name
 * @param options - Cleanup options
 * @returns Cleanup result with counts and warnings
 */
export async function cleanupDockerResources(
  projectName: string,
  options: DockerCleanupOptions = {}
): Promise<DockerCleanupResult> {
  const result: DockerCleanupResult = {
    volumesRemoved: 0,
    networksRemoved: 0,
    containersRemoved: 0,
    imagesRemoved: 0,
    totalRemoved: 0,
    warnings: [],
    dockerAvailable: false,
  }

  // Check Docker availability
  if (!(await isDockerAvailable())) {
    result.warnings.push('Docker daemon not available - skipping cleanup')
    return result
  }

  result.dockerAvailable = true

  // 1. Remove containers
  const containers = await listProjectContainers(projectName)
  for (const containerId of containers) {
    try {
      if (!options.dryRun) {
        await removeContainer(containerId)
      }
      result.containersRemoved++
    } catch (error) {
      result.warnings.push(`Failed to remove container ${containerId}: ${error}`)
    }
  }

  // 2. Remove volumes
  const volumes = await listProjectVolumes(projectName)
  for (const volume of volumes) {
    try {
      if (!options.dryRun) {
        await removeVolume(volume)
      }
      result.volumesRemoved++
    } catch (error) {
      result.warnings.push(`Failed to remove volume ${volume}: ${error}`)
    }
  }

  // 3. Remove networks
  const networks = await listProjectNetworks(projectName)
  for (const network of networks) {
    try {
      if (!options.dryRun) {
        await removeNetwork(network)
      }
      result.networksRemoved++
    } catch (error) {
      result.warnings.push(`Failed to remove network ${network}: ${error}`)
    }
  }

  // 4. Remove images (if not skipped)
  if (!options.skipImages) {
    const images = await listProjectImages(projectName)
    for (const image of images) {
      try {
        if (!options.dryRun) {
          await removeImage(image.id)
        }
        result.imagesRemoved++
      } catch (error) {
        result.warnings.push(`Failed to remove image ${image.name}: ${error}`)
      }
    }
  }

  result.totalRemoved =
    result.volumesRemoved + result.networksRemoved + result.containersRemoved + result.imagesRemoved

  return result
}

/**
 * Scan Docker resources for a single project
 * Used by cleanup command to preview resources before deletion
 */
export async function scanDockerResourcesForProject(
  projectName: string
): Promise<DockerProjectResources> {
  const [volumes, networks, containers, images] = await Promise.all([
    listProjectVolumes(projectName),
    listProjectNetworks(projectName),
    listProjectContainers(projectName),
    listProjectImages(projectName),
  ])

  // Get image size estimate if images exist
  const imageSize =
    images.length > 0 ? await getImagesSizeInBytes(images.map(img => img.id)) : undefined

  return {
    projectName,
    volumes,
    networks,
    containers,
    images,
    // Size information could be added in the future
    volumeSize: undefined,
    imageSize,
  }
}
