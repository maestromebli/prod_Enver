using AssetManagement.Core.Models;
using MediatR;

namespace AssetManagement.Core.Queries;

public record GetAssetByIdQuery(Guid AssetId) : IRequest<AssetSummary?>;
