using AssetManagement.Core.Models;
using MediatR;

namespace AssetManagement.Core.Commands;

public record UpdateAssetStatusCommand(UpdateAssetStatusRequest Request) : IRequest<AssetSummary>;
